import * as THREE from 'three';
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
  private pmremGenerator: THREE.PMREMGenerator | null = null;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
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
  private loadedEnvCourseId: CourseId | null = null;
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
  private skidEmitAccum = 0;
  private currentFov = 62;
  private camRoll = 0;
  private camAccelLag = 0;
  private prevPlayerSpeed = 0;
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

    this.hemiLight = new THREE.HemisphereLight(0x82b4e2, 0x704026, 0.52);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffd9a0, 1.55);
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

    // Gentle opposing 3-point rim light for crisp silhouette separation without glare
    this.rimLight = new THREE.DirectionalLight(0x98bee8, 0.22);
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
      renderer.toneMappingExposure = 1.05;
      renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = !this.isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFShadowMap;

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

      this.pmremGenerator = new THREE.PMREMGenerator(renderer);
      this.pmremGenerator.compileEquirectangularShader();
      this.scene.environmentIntensity = 0.56;

      // Subtle high-threshold optical bloom on hardware GPUs (only true specular/LED peaks > 1.55 bloom)
      if (!this.isSoftwareGl) {
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(this.scene, this.camera));
        const bloom = new UnrealBloomPass(
          new THREE.Vector2(Math.floor(width * 0.5), Math.floor(height * 0.5)),
          0.11,
          0.35,
          1.55,
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

  private clearCourseObjects(keepEnv = false): void {
    if (!keepEnv && this.courseEnv) {
      this.scene.remove(this.courseEnv.group);
      this.courseEnv.dispose();
      this.courseEnv = null;
      this.loadedEnvCourseId = null;
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
    let sunIntensity = course.sunIntensity + 0.36;
    let hemiIntensity = course.hemiIntensity + 0.28;
    let envIntensity = 0.88;
    let auroraStrength = course.hasAurora ? 0.85 : 0.0;
    let starStrength = course.hasAurora ? 0.65 : 0.0;
    let headlightIntensity = 0.72;
    let beamOpacity = course.hasAurora ? 0.14 : 0.0;
    let bloomStrength = course.hasAurora ? 0.14 : 0.1;

    _sunDirScratch.set(course.sunPosition.x, course.sunPosition.y, course.sunPosition.z);

    if (this.timeOfDay === 'noon') {
      topHex = '#114a85';
      midHex = '#488cc2';
      horizonHex = '#b5d6ea';
      fogHex = '#a8cce0';
      fogDensity = course.fogDensity * 0.74;
      sunHex = '#fff4e0';
      sunIntensity = 2.08;
      hemiIntensity = 0.86;
      envIntensity = 0.92;
      auroraStrength = 0.0;
      starStrength = 0.0;
      headlightIntensity = 0.38;
      beamOpacity = 0.0;
      bloomStrength = 0.08;
      _sunDirScratch.set(course.sunPosition.x * 0.5, 290, course.sunPosition.z * 0.5);
    } else if (this.timeOfDay === 'twilight') {
      topHex = '#070f22';
      midHex = '#182a50';
      horizonHex = '#593d66';
      fogHex = '#242f4a';
      fogDensity = course.fogDensity * 1.08;
      sunHex = '#efa06e';
      sunIntensity = 1.24;
      hemiIntensity = 0.58;
      envIntensity = 0.62;
      auroraStrength = course.hasAurora ? 1.0 : 0.52;
      starStrength = 0.92;
      headlightIntensity = 1.18;
      beamOpacity = 0.18;
      bloomStrength = 0.16;
      _sunDirScratch.set(course.sunPosition.x, 42, course.sunPosition.z);
    }

    this.scene.background = new THREE.Color(fogHex);
    this.scene.fog = new THREE.FogExp2(fogHex, fogDensity);
    this.scene.environmentIntensity = envIntensity;
    this.sunLight.color.set(sunHex);
    this.sunLight.intensity = sunIntensity;
    this.rimLight.color.set(this.timeOfDay === 'twilight' ? '#7ab6ec' : '#d2e6fa');
    this.rimLight.intensity = this.timeOfDay === 'twilight' ? 0.42 : 0.36;
    this.hemiLight.color.set(this.timeOfDay === 'twilight' ? '#7aa0d8' : course.hemiSkyColor);
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

    this.updateSkyReflectionEnv(
      topHex,
      midHex,
      horizonHex,
      course.hemiGroundColor,
      sunHex,
      _sunDirScratch,
    );

    for (const rig of this.carRigs.values()) {
      rig.setHeadlightBoost(headlightIntensity, beamOpacity);
    }
  }

  private updateSkyReflectionEnv(
    topHex: string,
    midHex: string,
    horizonHex: string,
    groundHex: string,
    sunHex: string,
    sunDir: THREE.Vector3,
  ): void {
    if (!this.pmremGenerator) return;

    const envScene = new THREE.Scene();
    const skyGeo = new THREE.SphereGeometry(20, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: new THREE.Color(topHex) },
        uMid: { value: new THREE.Color(midHex) },
        uHorizon: { value: new THREE.Color(horizonHex) },
        uGround: { value: new THREE.Color(groundHex) },
        uSun: { value: new THREE.Color(sunHex) },
        uSunDir: { value: sunDir.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col;
          if (d.y >= 0.0) {
            col = mix(uHorizon, uMid, smoothstep(0.0, 0.30, d.y));
            col = mix(col, uTop, smoothstep(0.24, 0.85, d.y));
            col *= 1.55;
          } else {
            col = mix(uHorizon * 1.12, uGround * 0.92, smoothstep(0.0, -0.35, d.y));
          }
          float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSun * (pow(sunDot, 10.0) * 0.55 + pow(sunDot, 84.0) * 2.1);
          // Crisp luminous skyband & overhead cloud bounce for glossy automotive clearcoat & alloy rims
          float skyHighlight = exp(-abs(d.y - 0.18) * 9.5) * 0.52;
          float zenithFill = smoothstep(0.35, 0.92, d.y) * 0.32;
          col += mix(uHorizon, uSun, 0.45) * skyHighlight + mix(uMid, vec3(0.92, 0.95, 1.0), 0.35) * zenithFill;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    envScene.add(skyDome);

    const nextTarget = this.pmremGenerator.fromScene(envScene, 0.025);
    skyGeo.dispose();
    skyMat.dispose();

    if (this.envRenderTarget) {
      this.envRenderTarget.dispose();
    }
    this.envRenderTarget = nextTarget;
    this.scene.environment = nextTarget.texture;
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    this.applyAtmosphereLighting();
  }

  public loadCourseWorld(courseId: CourseId, mode: GameMode, skipCountdown = false): void {
    const reuseEnv = this.courseEnv !== null && this.loadedEnvCourseId === courseId;
    this.courseId = courseId;
    this.gameMode = mode;
    this.clearCourseObjects(reuseEnv);

    const course = COURSES[courseId];
    if (!reuseEnv) {
      this.track = buildTrack(course);
    }
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
    if (!reuseEnv) {
      this.courseEnv = buildCourseEnvironment(this.track, maxAniso);
      this.loadedEnvCourseId = courseId;
      this.scene.add(this.courseEnv.group);
    } else {
      this.courseEnv?.skidmarks.clear();
    }
    this.courseEnv?.syncPosts(this.world.posts);
    this.prevPlayerSpeed = 0;
    this.camAccelLag = 0;

    // Spawn hyper-detailed composite 3D cars for player + rivals
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

    if (!reuseEnv && this.renderer && !this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.callbacks.onTrackReady(this.track);
    if (this.phase === 'title') {
      this.snapCameraToTitle();
    } else {
      this.snapCameraToGameplay();
    }
    this.lastTimestamp = performance.now();
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

    // Longitudinal acceleration squat / braking dive G-force camera feel
    const accel = (p.speed - this.prevPlayerSpeed) / Math.max(0.008, dt);
    this.prevPlayerSpeed = p.speed;
    const targetLag = Math.max(-0.55, Math.min(0.85, accel * 0.022));
    this.camAccelLag += (targetLag - this.camAccelLag) * (1 - Math.exp(-6.5 * dt));

    // Tactile micro-road vibration at high speed, serrated apex curbs, or gravel runoff shoulder
    const surfaceRough = p.surface === 'shoulder' ? 0.048 : p.surface === 'curb' ? 0.026 : 0.008;
    const roadBuzzY =
      !p.airborne && speedRatio > 0.25
        ? Math.sin(elapsed * 42) * surfaceRough * speedRatio
        : 0;

    if (this.cameraMode === 'chase') {
      const dist =
        8.0 +
        speedRatio * 1.45 +
        this.camAccelLag +
        (boosting ? 0.95 : 0) +
        (p.airborne ? 1.1 : 0);
      const height = 3.25 + speedRatio * 0.35 + roadBuzzY + (p.airborne ? 0.65 : 0);
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
      _camDesired.set(
        p.x + fwd.x * (0.65 - this.camAccelLag * 0.14),
        p.y + 1.48 + roadBuzzY * 0.65,
        p.z + fwd.z * (0.65 - this.camAccelLag * 0.14),
      );
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
    this.camera.rotation.x += shakeX - this.camAccelLag * 0.012;
  }

  private emitVehicleParticles(dt: number, playerBraking: boolean): void {
    if (!this.courseEnv) return;
    this.particleEmitAccum += dt;
    this.skidEmitAccum += dt;

    const pool = this.courseEnv.particles;
    const skids = this.courseEnv.skidmarks;
    const allCars = [this.world.player, ...this.world.rivals];

    // Persistent 3D rubber tire skidmarks during drifting or hard braking
    if (this.skidEmitAccum >= 0.026) {
      this.skidEmitAccum = 0;
      for (const car of allCars) {
        if (car.airborne || car.surface !== 'asphalt') continue;
        const speedAbs = Math.abs(car.speed);
        const hardBrake = car.isPlayer && playerBraking && speedAbs > 18;
        if ((car.isDrifting && speedAbs > 12) || hardBrake) {
          const fwd = headingToForward(car.heading);
          const right = headingToRight(car.heading);
          const sample = sampleTrackAtDistance(this.track, car.trackS);
          const segLen = Math.max(0.8, Math.min(2.4, speedAbs * 0.042));
          for (const side of [-0.94, 0.94]) {
            skids.stamp(
              car.x - fwd.x * 1.28 + right.x * side,
              car.groundY,
              car.z - fwd.z * 1.28 + right.z * side,
              car.heading,
              sample.bankAngle,
              segLen,
              0.31,
            );
          }
        }
      }
    }

    if (this.particleEmitAccum < 0.032) return;
    this.particleEmitAccum = 0;

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

      // High-speed aerodynamic wingtip airflow streaks past player car (>185 KM/H or boosting/drafting)
      if (
        car.isPlayer &&
        (Math.abs(car.speed) * 3.6 > 185 || car.isBoosting || car.slipstreamIntensity > 0.25)
      ) {
        const side = Math.random() > 0.5 ? 1.06 : -1.06;
        pool.emit(
          car.x - fwd.x * 1.9 + right.x * side,
          car.y + 1.16 + (Math.random() - 0.5) * 0.14,
          car.z - fwd.z * 1.9 + right.z * side,
          -fwd.x * 16,
          0.08,
          -fwd.z * 16,
          0.11,
          0.18,
          car.slipstreamIntensity > 0.25 ? 0x7dd3fc : 0xe2e8f0,
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
        gear: this.world.player.gear,
        surface: this.world.player.surface,
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
          } else if (ev.type === 'post-hit') {
            const px = ev.x ?? p.x;
            const py = ev.y ?? p.y + 0.5;
            const pz = ev.z ?? p.z;
            for (let i = 0; i < 8; i++) {
              this.courseEnv.particles.emit(
                px + (Math.random() - 0.5) * 0.5,
                py + Math.random() * 0.4,
                pz + (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 9,
                2.5 + Math.random() * 4.5,
                (Math.random() - 0.5) * 9,
                0.14,
                0.36,
                i % 2 === 0 ? 0xe85d1a : 0xe7e8ec,
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

      this.courseEnv?.syncPosts(this.world.posts);

      const allCars = [this.world.player, ...this.world.rivals];
      for (const car of allCars) {
        const rig = this.carRigs.get(car.id);
        if (!rig) continue;
        const sample = sampleTrackAtDistance(this.track, car.trackS);
        const braking = car.isPlayer ? input.brake > 0.1 : false;
        syncCarRigToState(rig, car, sample.bankAngle, braking, this.world.elapsedTime);
      }

      this.emitVehicleParticles(dt, input.brake > 0.15);

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
    if (this.envRenderTarget) {
      this.envRenderTarget.dispose();
      this.envRenderTarget = null;
    }
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
      this.pmremGenerator = null;
    }
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
