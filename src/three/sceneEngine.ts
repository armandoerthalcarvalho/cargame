import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { DrivingAudioEngine } from '../game/audio';
import { COURSES, LIVERY_PRESETS } from '../game/courses';
import { headingToForward, headingToRight } from '../game/physics';
import { buildRunSnapshot, createRaceWorld, resetCarToTrack, stepRaceWorld } from '../game/race';
import { buildTrack, sampleTrackAtDistance } from '../game/track';
import type { TrackData } from '../game/track';
import type {
  CameraMode,
  CourseId,
  GameMode,
  GamePhase,
  HudTelemetry,
  InputState,
  LiveryConfig,
  RaceWorldState,
  RadioStationId,
  RunSnapshot,
  TimeOfDay,
} from '../game/types';
import { buildCompositeCar, syncCarRigToState } from './carBuilder';
import type { CarMeshRig } from './carBuilder';
import { buildCourseEnvironment } from './environmentBuilder';
import type { CourseEnvironment } from './environmentBuilder';
import { createContactShadowTexture, createHeadlightBeamTexture } from './textures';

export interface EngineCallbacks {
  onPhaseChange: (phase: GamePhase) => void;
  onTelemetry: (telemetry: HudTelemetry) => void;
  onRaceFinish: (snapshot: RunSnapshot) => void;
  onMuteChange: (muted: boolean) => void;
  onCameraChange: (mode: CameraMode) => void;
  onTrackReady: (track: TrackData) => void;
  onWebglError: (message: string) => void;
}

export interface TouchInputState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  boost: boolean;
}

const _camDesired = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _sunDirScratch = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class SolsticeSceneEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer | null = null;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private envTexture: THREE.Texture | null = null;
  private contactShadowTex: THREE.CanvasTexture;
  private headlightBeamTex: THREE.CanvasTexture;

  private courseId: CourseId = 'sunstone-canyon';
  private gameMode: GameMode = 'grand-prix';
  private timeOfDay: TimeOfDay = 'golden';
  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'chase';
  private liveryConfig: LiveryConfig = { ...LIVERY_PRESETS[0] };

  private track: TrackData;
  private world: RaceWorldState;
  private courseEnv: CourseEnvironment | null = null;
  private carRigs = new Map<string, CarMeshRig>();

  private audio = new DrivingAudioEngine();
  private keysHeld = new Set<string>();
  private touchInput: TouchInputState = {
    left: false,
    right: false,
    throttle: false,
    brake: false,
    drift: false,
    boost: false,
  };

  private frameId = 0;
  private disposed = false;
  private lastTimestamp = 0;
  private titleOrbitAngle = 0.42;
  private topSpeedKmh = 0;
  private finishDelayTimer = -1;
  private telemetryAccum = 0;
  private particleEmitAccum = 0;
  private currentFov = 62;
  private camRoll = 0;
  private modalOpen = false;
  private autostartSkipCountdown = false;

  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    callbacks: EngineCallbacks,
    initialCourse: CourseId = 'sunstone-canyon',
    initialMode: GameMode = 'grand-prix',
    autostart = false,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.courseId = initialCourse;
    this.gameMode = initialMode;
    this.autostartSkipCountdown = autostart;
    this.isSoftwareGl = detectSoftwareGl();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.25, 1600);

    this.hemiLight = new THREE.HemisphereLight(0x88bbee, 0x804b2d, 1.0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffdfb0, 2.4);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 320;
    const d = 62;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Subtle opposing 3-point rim light to carve sharp highlights along GT bodywork
    this.rimLight = new THREE.DirectionalLight(0x9ac8ff, 0.56);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    this.contactShadowTex = createContactShadowTexture();
    this.headlightBeamTex = createHeadlightBeamTexture();
    this.track = buildTrack(COURSES[this.courseId]);
    this.world = createRaceWorld(
      this.track,
      this.gameMode,
      {
        bodyColor: this.liveryConfig.bodyColor,
        accentColor: this.liveryConfig.accentColor,
      },
      { tuning: this.liveryConfig.tuning, skipCountdown: autostart },
    );

    this.initRenderer();
    this.loadCourseWorld(this.courseId, this.gameMode, autostart);
    this.bindEvents();

    if (autostart) {
      this.startRace(true);
    } else {
      this.setPhase('title');
      this.snapCameraToTitle();
    }

    this.lastTimestamp = performance.now();
    this.scheduleNextTick();
  }

  private initRenderer(): void {
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.14;
      renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = !this.isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const width = Math.max(1, this.container.clientWidth || window.innerWidth);
      const height = Math.max(1, this.container.clientHeight || window.innerHeight);
      renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.setAttribute('data-testid', 'game-canvas');

      renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.callbacks.onWebglError(
          'WebGL rendering context was lost. Please reload to restore 3D graphics.',
        );
      });

      this.container.appendChild(renderer.domElement);
      this.renderer = renderer;

      const pmrem = new THREE.PMREMGenerator(renderer);
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.envTexture;
      pmrem.dispose();

      // Cinematic selective-threshold Bloom + ACES OutputPass on hardware GPUs (zero stall on SwiftShader)
      if (!this.isSoftwareGl) {
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));
        const bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.floor(width * 0.5), Math.floor(height * 0.5)),
          0.32,
          0.52,
          0.92,
        );
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
        this.composer = composer;
        this.bloomPass = bloom;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to initialize WebGL context.';
      this.callbacks.onWebglError(msg);
    }
  }

  private getMaxAnisotropy(): number {
    return this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 1;
  }

  private clearCourseObjects(): void {
    if (this.courseEnv) {
      this.scene.remove(this.courseEnv.group);
      this.courseEnv.dispose();
      this.courseEnv = null;
    }
    for (const rig of this.carRigs.values()) {
      this.scene.remove(rig.root);
      rig.dispose();
    }
    this.carRigs.clear();
  }

  private applyAtmosphereLighting(): void {
    const course = COURSES[this.courseId];
    let topHex = course.skyTop;
    let midHex = course.skyMid;
    let horizonHex = course.skyHorizon;
    let fogHex = course.fogColor;
    let fogDensity = course.fogDensity;
    let sunHex = course.sunColor;
    let sunIntensity = course.sunIntensity;
    let hemiIntensity = course.hemiIntensity;
    let auroraStrength = course.hasAurora ? 1.0 : 0.0;
    let starStrength = course.hasAurora ? 0.75 : 0.0;
    let headlightIntensity = 1.75;
    let beamOpacity = course.hasAurora ? 0.34 : 0.14;
    let bloomStrength = course.hasAurora ? 0.42 : 0.32;

    _sunDirScratch.set(course.sunPosition.x, course.sunPosition.y, course.sunPosition.z);

    if (this.timeOfDay === 'noon') {
      topHex = '#0d4e94';
      midHex = '#4b98db';
      horizonHex = '#d5eefc';
      fogHex = '#c5e4f5';
      fogDensity = course.fogDensity * 0.78;
      sunHex = '#fffaf0';
      sunIntensity = 2.85;
      hemiIntensity = 1.18;
      auroraStrength = 0.0;
      starStrength = 0.0;
      headlightIntensity = 1.0;
      beamOpacity = 0.0;
      bloomStrength = 0.22;
      _sunDirScratch.set(course.sunPosition.x * 0.5, 290, course.sunPosition.z * 0.5);
    } else if (this.timeOfDay === 'twilight') {
      topHex = '#070f24';
      midHex = '#1b2f5c';
      horizonHex = '#6b4978';
      fogHex = '#2a3554';
      fogDensity = course.fogDensity * 1.18;
      sunHex = '#ffae78';
      sunIntensity = 1.7;
      hemiIntensity = 0.88;
      auroraStrength = course.hasAurora ? 1.25 : 0.65;
      starStrength = 1.0;
      headlightIntensity = 3.4;
      beamOpacity = 0.48;
      bloomStrength = 0.48;
      _sunDirScratch.set(course.sunPosition.x, 42, course.sunPosition.z);
    }

    this.scene.background = new THREE.Color(fogHex);
    this.scene.fog = new THREE.FogExp2(fogHex, fogDensity);
    this.sunLight.color.set(sunHex);
    this.sunLight.intensity = sunIntensity;
    this.rimLight.color.set(this.timeOfDay === 'twilight' ? '#7ec4ff' : '#d6eaff');
    this.rimLight.intensity = this.timeOfDay === 'twilight' ? 0.72 : 0.52;
    this.hemiLight.color.set(this.timeOfDay === 'twilight' ? '#7aa4e8' : course.hemiSkyColor);
    this.hemiLight.groundColor.set(course.hemiGroundColor);
    this.hemiLight.intensity = hemiIntensity;

    if (this.bloomPass) {
      this.bloomPass.strength = bloomStrength;
    }

    this.courseEnv?.setAtmosphere({
      topHex,
      midHex,
      horizonHex,
      sunHex,
      sunDir: _sunDirScratch,
      auroraStrength,
      starStrength,
    });

    for (const rig of this.carRigs.values()) {
      rig.setHeadlightBoost(headlightIntensity, beamOpacity);
    }
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    this.applyAtmosphereLighting();
  }

  public loadCourseWorld(courseId: CourseId, mode: GameMode, skipCountdown = false): void {
    this.courseId = courseId;
    this.gameMode = mode;
    this.clearCourseObjects();

    const course = COURSES[courseId];
    this.track = buildTrack(course);
    this.world = createRaceWorld(
      this.track,
      mode,
      {
        bodyColor: this.liveryConfig.bodyColor,
        accentColor: this.liveryConfig.accentColor,
      },
      { tuning: this.liveryConfig.tuning, skipCountdown },
    );
    this.topSpeedKmh = 0;
    this.finishDelayTimer = -1;

    const maxAniso = this.getMaxAnisotropy();
    this.courseEnv = buildCourseEnvironment(this.track, maxAniso);
    this.scene.add(this.courseEnv.group);

    // Spawn composite 22-part 3D cars for player + rivals
    const rivalNumbers = ['11', '42', '88'];
    const allCars = [this.world.player, ...this.world.rivals];
    allCars.forEach((car, idx) => {
      const rig = buildCompositeCar({
        bodyColor: car.colorHex,
        accentColor: car.accentHex,
        contactShadowTex: this.contactShadowTex,
        headlightBeamTex: this.headlightBeamTex,
        maxAnisotropy: maxAniso,
        initialConfig: car.isPlayer ? this.liveryConfig : undefined,
        racingNumber: car.isPlayer
          ? this.liveryConfig.racingNumber
          : rivalNumbers[(idx - 1) % rivalNumbers.length],
      });
      const sample = sampleTrackAtDistance(this.track, car.trackS);
      syncCarRigToState(rig, car, sample.bankAngle, false, 0);
      this.scene.add(rig.root);
      this.carRigs.set(car.id, rig);
    });

    this.applyAtmosphereLighting();

    if (this.renderer && !this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.callbacks.onTrackReady(this.track);
    if (this.phase === 'title') {
      this.snapCameraToTitle();
    } else {
      this.snapCameraToGameplay();
    }
    this.emitTelemetryNow();
  }

  public setModalOpen(open: boolean): void {
    this.modalOpen = open;
    if (open) {
      this.keysHeld.clear();
    }
    if (this.phase === 'title') {
      if (open) {
        this.snapCameraToShowroom();
      } else {
        this.snapCameraToTitle();
      }
    }
  }

  private snapCameraToShowroom(): void {
    const p = this.world.player;
    const fwd = headingToForward(p.heading);
    const right = headingToRight(p.heading);
    const azim = 0.64;
    const radius = 6.2;
    this.camera.position.set(
      p.x + fwd.x * Math.cos(azim) * radius + right.x * Math.sin(azim) * radius,
      p.y + 1.58,
      p.z + fwd.z * Math.cos(azim) * radius + right.z * Math.sin(azim) * radius,
    );
    const toCarX = p.x - this.camera.position.x;
    const toCarZ = p.z - this.camera.position.z;
    const len = Math.hypot(toCarX, toCarZ) || 1;
    const camRightX = -toCarZ / len;
    const camRightZ = toCarX / len;
    _camLook.set(p.x - camRightX * 1.48, p.y + 0.78, p.z - camRightZ * 1.48);
    this.camera.lookAt(_camLook);
  }

  public applyLivery(config: LiveryConfig): void {
    this.liveryConfig = { ...config };
    this.world.tuning = config.tuning;
    this.world.player.colorHex = config.bodyColor;
    this.world.player.accentHex = config.accentColor;
    const playerRig = this.carRigs.get('player');
    playerRig?.applyLivery(this.liveryConfig);
    this.emitTelemetryNow();
  }

  public setRadioStation(station: RadioStationId): void {
    this.audio.setRadioStation(station);
  }

  public setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
    this.callbacks.onMuteChange(muted);
  }

  public toggleMute(): void {
    this.setMuted(!this.audio.isMuted());
  }

  public cycleCamera(): void {
    const order: CameraMode[] = ['chase', 'hood', 'helo'];
    const idx = order.indexOf(this.cameraMode);
    this.cameraMode = order[(idx + 1) % order.length];
    this.callbacks.onCameraChange(this.cameraMode);
    this.emitTelemetryNow();
  }

  public resetPlayerToTrack(): void {
    if (this.phase !== 'playing') return;
    resetCarToTrack(this.world.player, this.track);
    this.world.bannerText = 'RESET TO TRACK';
    this.world.bannerTone = 'cyan';
    this.world.bannerTimer = 1.2;
    this.emitTelemetryNow();
  }

  public setTouchInput(partial: Partial<TouchInputState>): void {
    Object.assign(this.touchInput, partial);
  }

  private setPhase(next: GamePhase): void {
    this.phase = next;
    document.body.dataset.state = next;
    this.callbacks.onPhaseChange(next);
  }

  public startRace(skipCountdown = false): void {
    this.audio.unlock();
    this.keysHeld.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.loadCourseWorld(
      this.courseId,
      this.gameMode,
      skipCountdown || this.autostartSkipCountdown,
    );
    this.autostartSkipCountdown = false;
    this.setPhase('playing');
    this.snapCameraToGameplay();
  }

  public pauseRace(): void {
    if (this.phase !== 'playing') return;
    this.keysHeld.clear();
    this.audio.updateDrivingLoop({
      active: false,
      rpm: 0,
      speedKmh: 0,
      isDrifting: false,
      driftAngle: 0,
      isBoosting: false,
    });
    this.setPhase('paused');
  }

  public resumeRace(): void {
    if (this.phase !== 'paused') return;
    this.audio.unlock();
    this.keysHeld.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.lastTimestamp = performance.now();
    this.setPhase('playing');
  }

  public returnToTitle(): void {
    this.keysHeld.clear();
    this.audio.updateDrivingLoop({
      active: false,
      rpm: 0,
      speedKmh: 0,
      isDrifting: false,
      driftAngle: 0,
      isBoosting: false,
    });
    this.loadCourseWorld(this.courseId, this.gameMode);
    this.setPhase('title');
    this.snapCameraToTitle();
  }

  private isTypingInField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.modalOpen || this.isTypingInField(e.target)) return;

    const code = e.code;
    const isGameKey =
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight';

    if (isGameKey) {
      e.preventDefault();
    }

    if (!e.repeat) {
      if (this.phase === 'title' && (code === 'Enter' || code === 'Space')) {
        e.preventDefault();
        this.startRace();
        return;
      }
      if (code === 'Escape' || code === 'KeyP') {
        if (this.phase === 'playing') {
          this.pauseRace();
          return;
        } else if (this.phase === 'paused') {
          this.resumeRace();
          return;
        }
      }
      if (code === 'KeyM') {
        this.toggleMute();
        return;
      }
      if (this.phase === 'playing') {
        if (code === 'KeyC') {
          this.cycleCamera();
          return;
        }
        if (code === 'KeyT') {
          this.resetPlayerToTrack();
          return;
        }
        if (code === 'KeyR') {
          this.startRace();
          return;
        }
      }
    }

    this.keysHeld.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysHeld.delete(e.code);
  };

  private onBlurOrHide = () => {
    this.keysHeld.clear();
    this.touchInput = {
      left: false,
      right: false,
      throttle: false,
      brake: false,
      drift: false,
      boost: false,
    };
  };

  private handleResize = () => {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(Math.floor(width * 0.5), Math.floor(height * 0.5));
    }
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlurOrHide);
    document.addEventListener('visibilitychange', this.onBlurOrHide);
    window.addEventListener('resize', this.handleResize);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.container);
    }
  }

  private samplePlayerInput(): InputState {
    const k = this.keysHeld;
    const t = this.touchInput;
    const throttle = k.has('KeyW') || k.has('ArrowUp') || t.throttle ? 1 : 0;
    const brake = k.has('KeyS') || k.has('ArrowDown') || t.brake ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') || t.left ? 1 : 0;
    const right = k.has('KeyD') || k.has('ArrowRight') || t.right ? 1 : 0;
    const drift = k.has('Space') || t.drift;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE') || t.boost;

    return {
      throttle,
      brake,
      steer: left - right,
      drift,
      boost,
    };
  }

  private snapCameraToTitle(): void {
    const p = this.world.player;
    const fwd = headingToForward(p.heading);
    const right = headingToRight(p.heading);
    const angle = 0.42;
    const radius = 8.6;
    this.camera.position.set(
      p.x - fwd.x * Math.cos(angle) * radius - right.x * Math.sin(angle) * radius,
      p.y + 2.8,
      p.z - fwd.z * Math.cos(angle) * radius - right.z * Math.sin(angle) * radius,
    );
    _camLook.set(
      p.x + fwd.x * 5.0 - right.x * 1.4,
      p.y + 1.2,
      p.z + fwd.z * 5.0 - right.z * 1.4,
    );
    this.camera.lookAt(_camLook);
    this.camera.fov = 54;
    this.camera.updateProjectionMatrix();
  }

  private snapCameraToGameplay(): void {
    const p = this.world.player;
    const fwd = headingToForward(p.heading);
    this.camera.position.set(p.x - fwd.x * 8.6, p.y + 3.4, p.z - fwd.z * 8.6);
    _camLook.set(p.x + fwd.x * 14, p.y + 1.4, p.z + fwd.z * 14);
    this.camera.lookAt(_camLook);
    this.currentFov = 62;
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(dt: number, elapsed: number): void {
    const p = this.world.player;

    if (this.phase === 'title') {
      const fwd = headingToForward(p.heading);
      const right = headingToRight(p.heading);

      if (this.modalOpen) {
        // Front-right 3/4 showroom hero shot with lookAt shifted camera-left so the GT supercar
        // sits cleanly centered in the open right 60% of the screen beside the Garage drawer
        this.titleOrbitAngle += dt * 0.24;
        const azim = 0.64 + Math.sin(this.titleOrbitAngle) * 0.22;
        const radius = 6.2;
        _camDesired.set(
          p.x + fwd.x * Math.cos(azim) * radius + right.x * Math.sin(azim) * radius,
          p.y + 1.58 + Math.sin(elapsed * 0.55) * 0.06,
          p.z + fwd.z * Math.cos(azim) * radius + right.z * Math.sin(azim) * radius,
        );
        const damp = 1 - Math.exp(-5.5 * dt);
        this.camera.position.lerp(_camDesired, damp);

        // Compute camera-right vector from current camera to car, then shift lookAt camera-left
        const toCarX = p.x - this.camera.position.x;
        const toCarZ = p.z - this.camera.position.z;
        const len = Math.hypot(toCarX, toCarZ) || 1;
        // cross((toCarX, 0, toCarZ), (0, 1, 0)) = (-toCarZ, 0, toCarX) = camera-right
        const camRightX = -toCarZ / len;
        const camRightZ = toCarX / len;
        _camLook.set(
          p.x - camRightX * 1.48,
          p.y + 0.78,
          p.z - camRightZ * 1.48,
        );
        this.camera.lookAt(_camLook);
        return;
      }

      this.titleOrbitAngle += dt * 0.14;
      const sway = Math.sin(this.titleOrbitAngle) * 0.38 + 0.42;
      const radius = 8.8;
      _camDesired.set(
        p.x - fwd.x * Math.cos(sway) * radius - right.x * Math.sin(sway) * radius,
        p.y + 2.85 + Math.sin(elapsed * 0.5) * 0.22,
        p.z - fwd.z * Math.cos(sway) * radius - right.z * Math.sin(sway) * radius,
      );
      const damp = 1 - Math.exp(-3.8 * dt);
      this.camera.position.lerp(_camDesired, damp);
      _camLook.set(
        p.x + fwd.x * 5.2 - right.x * 1.45,
        p.y + 1.2,
        p.z + fwd.z * 5.2 - right.z * 1.45,
      );
      this.camera.lookAt(_camLook);
      return;
    }

    const fwd = headingToForward(p.heading);
    const right = headingToRight(p.heading);
    const speedRatio = Math.max(0, Math.min(1.3, Math.abs(p.speed) / 64));
    const boosting = p.isBoosting || p.padBoostTimer > 0;

    if (this.cameraMode === 'chase') {
      const dist = 8.0 + speedRatio * 1.45 + (boosting ? 0.95 : 0) + (p.airborne ? 1.1 : 0);
      const height = 3.25 + speedRatio * 0.35 + (p.airborne ? 0.65 : 0);
      const driftLead = p.driftAngle * 2.2;
      _camDesired.set(
        p.x - fwd.x * dist + right.x * driftLead,
        p.y + height,
        p.z - fwd.z * dist + right.z * driftLead,
      );
      _camTarget.set(p.x + fwd.x * 14, p.y + 1.35, p.z + fwd.z * 14);

      const posDamp = 1 - Math.exp(-8.5 * dt);
      this.camera.position.lerp(_camDesired, posDamp);
      const lookDamp = 1 - Math.exp(-12 * dt);
      _camLook.lerp(_camTarget, lookDamp);
    } else if (this.cameraMode === 'hood') {
      _camDesired.set(p.x + fwd.x * 0.65, p.y + 1.48, p.z + fwd.z * 0.65);
      _camTarget.set(p.x + fwd.x * 28, p.y + 1.22, p.z + fwd.z * 28);
      this.camera.position.copy(_camDesired);
      _camLook.copy(_camTarget);
    } else {
      _camDesired.set(p.x - fwd.x * 15, p.y + 11.5, p.z - fwd.z * 15);
      _camTarget.set(p.x + fwd.x * 8, p.y + 0.8, p.z + fwd.z * 8);
      const posDamp = 1 - Math.exp(-5.5 * dt);
      this.camera.position.lerp(_camDesired, posDamp);
      _camLook.lerp(_camTarget, posDamp);
    }

    const targetFov =
      this.cameraMode === 'hood'
        ? 68 + speedRatio * 10 + (boosting ? 8 : 0)
        : 60 + speedRatio * 10 + (boosting ? 9 : 0);
    this.currentFov += (targetFov - this.currentFov) * (1 - Math.exp(-6.5 * dt));
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(_camLook);

    const targetRoll = this.cameraMode === 'chase' ? -p.angularVelocity * speedRatio * 0.024 : 0;
    this.camRoll += (targetRoll - this.camRoll) * (1 - Math.exp(-7 * dt));
    const shake = this.world.cameraTrauma * this.world.cameraTrauma;
    const shakeZ = shake > 0.001 ? Math.sin(elapsed * 64) * shake * 0.055 : 0;
    const shakeX = shake > 0.001 ? Math.cos(elapsed * 53) * shake * 0.032 : 0;
    this.camera.rotation.z += this.camRoll + shakeZ;
    this.camera.rotation.x += shakeX;
  }

  private emitVehicleParticles(dt: number): void {
    if (!this.courseEnv) return;
    this.particleEmitAccum += dt;
    if (this.particleEmitAccum < 0.032) return;
    this.particleEmitAccum = 0;

    const pool = this.courseEnv.particles;
    const allCars = [this.world.player, ...this.world.rivals];

    for (const car of allCars) {
      const fwd = headingToForward(car.heading);
      const right = headingToRight(car.heading);

      if (car.isDrifting && !car.airborne && Math.abs(car.speed) > 15) {
        for (const side of [-0.92, 0.92]) {
          pool.emit(
            car.x - fwd.x * 1.45 + right.x * side,
            car.y + 0.25,
            car.z - fwd.z * 1.45 + right.z * side,
            -fwd.x * 3 + (Math.random() - 0.5) * 2.5,
            1.4 + Math.random() * 1.1,
            -fwd.z * 3 + (Math.random() - 0.5) * 2.5,
            0.55,
            0.65,
            0xe8e2d8,
          );
        }
      }

      if (car.isBoosting || car.padBoostTimer > 0) {
        pool.emit(
          car.x - fwd.x * 2.6 + (Math.random() - 0.5) * 0.6,
          car.y + 0.36,
          car.z - fwd.z * 2.6 + (Math.random() - 0.5) * 0.6,
          -fwd.x * 11 + (Math.random() - 0.5) * 2,
          0.6 + Math.random() * 1.2,
          -fwd.z * 11 + (Math.random() - 0.5) * 2,
          0.36,
          0.32,
          car.padBoostTimer > 0 ? 0x38e8ff : 0xffaa2b,
        );
      }

      if (car.surface === 'shoulder' && !car.airborne && Math.abs(car.speed) > 12) {
        pool.emit(
          car.x - fwd.x * 1.8 + (Math.random() - 0.5) * 1.4,
          car.y + 0.2,
          car.z - fwd.z * 1.8 + (Math.random() - 0.5) * 1.4,
          (Math.random() - 0.5) * 3,
          1.8,
          (Math.random() - 0.5) * 3,
          0.48,
          0.55,
          0xc89b72,
        );
      }
    }
  }

  private emitTelemetryNow(): void {
    const p = this.world.player;
    const allCars = [p, ...this.world.rivals];
    const pos = Math.max(1, this.world.standings.indexOf('player') + 1);

    this.callbacks.onTelemetry({
      speedKmh: Math.round(Math.abs(p.speed) * 3.6),
      gear: p.gear,
      rpm: p.rpm,
      boostEnergy: Math.round(p.boostEnergy),
      isBoosting: p.isBoosting || p.padBoostTimer > 0,
      isDrifting: p.isDrifting,
      airborne: p.airborne,
      activeDriftScore: Math.round(p.activeDriftScore),
      totalStyleScore: Math.round(p.totalStyleScore),
      comboMultiplier: p.comboMultiplier,
      comboTimer: p.comboTimer,
      slipstream: p.slipstreamIntensity,
      position: pos,
      totalRacers: allCars.length,
      lap: p.lap,
      totalLaps: this.world.totalLaps,
      lapProgress: Math.max(0, Math.min(1, p.trackS / Math.max(1, this.track.totalLength))),
      elapsedTime: this.world.elapsedTime,
      currentLapTime: Math.max(0, this.world.elapsedTime - p.lapStartTime),
      bestLapTime: p.bestLapTime,
      countdownDigit: this.world.countdownTimer > 0 ? Math.ceil(this.world.countdownTimer) : 0,
      wrongWay: p.wrongWay,
      bannerText: this.world.bannerText,
      bannerTone: this.world.bannerTone,
      cameraMode: this.cameraMode,
      mode: this.world.mode,
      minimapRacers: allCars.map((c) => ({
        id: c.id,
        x: c.x,
        z: c.z,
        heading: c.heading,
        isPlayer: c.isPlayer,
        colorHex: c.isPlayer ? this.liveryConfig.accentColor : c.colorHex,
      })),
    });
  }

  private updateSunShadowAnchor(): void {
    const p = this.world.player;
    this.sunLight.position.set(
      p.x + _sunDirScratch.x * 0.75,
      p.y + Math.max(45, _sunDirScratch.y),
      p.z + _sunDirScratch.z * 0.75,
    );
    this.sunLight.target.position.set(p.x, p.y, p.z);
    this.sunLight.target.updateMatrixWorld();

    // Opposing cool rim backlight anchored around player for crisp silhouette highlights
    this.rimLight.position.set(
      p.x - _sunDirScratch.x * 0.55,
      p.y + 38,
      p.z - _sunDirScratch.z * 0.55,
    );
    this.rimLight.target.position.set(p.x, p.y + 0.8, p.z);
    this.rimLight.target.updateMatrixWorld();
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.max(0.001, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;
    const dt = Math.min(rawDt, 0.05);
    const elapsedSec = now * 0.001;

    if (this.phase === 'playing') {
      const input = this.samplePlayerInput();
      const events = stepRaceWorld(this.world, input, this.track, dt);

      const speedKmh = Math.abs(this.world.player.speed) * 3.6;
      if (speedKmh > this.topSpeedKmh) this.topSpeedKmh = speedKmh;

      this.audio.updateDrivingLoop({
        active: true,
        rpm: this.world.player.rpm,
        speedKmh,
        isDrifting: this.world.player.isDrifting,
        driftAngle: this.world.player.driftAngle,
        isBoosting: this.world.player.isBoosting || this.world.player.padBoostTimer > 0,
        airborne: this.world.player.airborne,
      });

      if (events.length > 0) {
        this.audio.triggerEvents(events);
        const p = this.world.player;
        for (const ev of events) {
          if (!this.courseEnv) break;
          if (ev.type === 'barrier-hit' || ev.type === 'car-bump') {
            const count = Math.round(8 + ev.intensity * 10);
            for (let i = 0; i < count; i++) {
              this.courseEnv.particles.emit(
                p.x + (Math.random() - 0.5) * 1.4,
                p.y + 0.6,
                p.z + (Math.random() - 0.5) * 1.4,
                (Math.random() - 0.5) * 14,
                3 + Math.random() * 6,
                (Math.random() - 0.5) * 14,
                0.22,
                0.42,
                0xffcf5c,
              );
            }
          } else if (ev.type === 'apex-ring' || ev.type === 'boost-pad' || ev.type === 'jump-land') {
            const burstColor =
              ev.type === 'apex-ring' ? 0x34f5c5 : ev.type === 'boost-pad' ? 0x38e8ff : 0xf5d79b;
            for (let i = 0; i < 12; i++) {
              this.courseEnv.particles.emit(
                p.x + (Math.random() - 0.5) * 2.0,
                p.y + 0.8,
                p.z + (Math.random() - 0.5) * 2.0,
                (Math.random() - 0.5) * 12,
                2.5 + Math.random() * 5.5,
                (Math.random() - 0.5) * 12,
                0.3,
                0.5,
                burstColor,
              );
            }
          }
        }
      }

      const allCars = [this.world.player, ...this.world.rivals];
      for (const car of allCars) {
        const rig = this.carRigs.get(car.id);
        if (!rig) continue;
        const sample = sampleTrackAtDistance(this.track, car.trackS);
        const braking = car.isPlayer ? input.brake > 0.1 : false;
        syncCarRigToState(rig, car, sample.bankAngle, braking, this.world.elapsedTime);
      }

      this.emitVehicleParticles(dt);

      if (this.world.player.finished) {
        if (this.finishDelayTimer < 0) {
          this.finishDelayTimer = 0.6;
        } else {
          this.finishDelayTimer -= dt;
          if (this.finishDelayTimer <= 0) {
            this.finishDelayTimer = -1;
            const snapshot = buildRunSnapshot(this.world, this.track, this.topSpeedKmh);
            this.audio.updateDrivingLoop({
              active: false,
              rpm: 0,
              speedKmh: 0,
              isDrifting: false,
              driftAngle: 0,
              isBoosting: false,
            });
            this.setPhase('gameover');
            this.callbacks.onRaceFinish(snapshot);
          }
        }
      }

      this.telemetryAccum += dt;
      if (this.telemetryAccum >= 0.08 || events.length > 0) {
        this.telemetryAccum = 0;
        this.emitTelemetryNow();
      }
    }

    const p = this.world.player;
    this.courseEnv?.update(elapsedSec, dt, p.x, p.y, p.z);

    this.updateCamera(dt, elapsedSec);
    this.updateSunShadowAnchor();

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }

    this.scheduleNextTick();
  };

  private scheduleNextTick(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl && this.renderer) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void): void {
    if (!this.renderer || this.disposed) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlurOrHide);
    document.removeEventListener('visibilitychange', this.onBlurOrHide);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();

    this.audio.dispose();
    this.clearCourseObjects();
    this.contactShadowTex.dispose();
    this.headlightBeamTex.dispose();
    if (this.envTexture) this.envTexture.dispose();
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
  }
}
