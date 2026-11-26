export type CourseId =
  | 'sunstone-canyon'
  | 'sunken-coast'
  | 'glacier-observatory'
  | 'sakura-skyway';

export type GameMode = 'grand-prix' | 'time-trial' | 'free-roam';

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraMode = 'chase' | 'hood' | 'helo';

export type TimeOfDay = 'golden' | 'noon' | 'twilight';

export type SurfaceType = 'asphalt' | 'curb' | 'shoulder';

export type RivalArchetype = 'apex-purist' | 'drift-maverick' | 'slipstream-hunter';

export type PaintFinish = 'gloss' | 'metallic' | 'matte';

export type RimFinish = 'alloy' | 'gold' | 'obsidian' | 'copper';

export type TuningClass = 'balanced' | 'drift' | 'aero';

export type RadioStationId = 'solstice' | 'coastal' | 'velocity' | 'off';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackFeatureSpec {
  id: string;
  type: 'boost-pad' | 'jump-ramp' | 'apex-ring';
  t: number; // normalized spline fraction 0..1
  lateral: number; // meters from centerline
}

export interface TrackFeatureInstance {
  id: string;
  type: 'boost-pad' | 'jump-ramp' | 'apex-ring';
  s: number;
  lateral: number;
  pos: Vec3;
  heading: number;
  bankAngle: number;
  radius: number;
}

export interface CourseTheme {
  id: CourseId;
  name: string;
  region: string;
  tagline: string;
  difficulty: 'Balanced' | 'Technical' | 'High Speed' | 'Flowing';
  roadWidth: number;
  shoulderWidth: number;
  totalLaps: number;
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fogColor: string;
  fogDensity: number;
  sunColor: string;
  sunIntensity: number;
  sunPosition: Vec3;
  hemiSkyColor: string;
  hemiGroundColor: string;
  hemiIntensity: number;
  asphaltTint: string;
  curbPrimary: string;
  curbSecondary: string;
  terrainLow: string;
  terrainMid: string;
  terrainHigh: string;
  accentHex: string;
  waterLevel: number | null;
  waterColor: string;
  waterDeepColor: string;
  hasAurora: boolean;
  ambientParticleColor: number;
  treeStyle: 'juniper' | 'cypress' | 'pine' | 'sakura';
  landmarkStyle: 'canyon-arch' | 'limestone-viaduct' | 'observatory-dome' | 'sakura-torii';
  controlPoints: ControlPoint[];
  features: TrackFeatureSpec[];
}

export interface TrackSample {
  index: number;
  s: number;
  t: number;
  pos: Vec3;
  tangent: Vec3;
  right: Vec3;
  curvature: number;
  bankAngle: number;
}

export interface TrackProjection {
  s: number;
  lateral: number;
  sampleIndex: number;
  sample: TrackSample;
  distanceSq: number;
  roadY: number;
}

export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) to +1 (left)
  drift: boolean;
  boost: boolean;
}

export interface PhysicsEvent {
  type:
    | 'barrier-hit'
    | 'boost-ignite'
    | 'drift-bank'
    | 'boost-pad'
    | 'jump-launch'
    | 'jump-land'
    | 'apex-ring';
  intensity: number;
  points?: number;
  label?: string;
}

export interface CarState {
  id: string;
  name: string;
  isPlayer: boolean;
  colorHex: string;
  accentHex: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  groundY: number;
  airborne: boolean;
  airtime: number;
  heading: number; // radians, forward = (sin(h), 0, cos(h))
  speed: number; // signed m/s along heading
  angularVelocity: number;
  steerAngle: number;
  wheelSpin: number;
  driftAngle: number;
  isDrifting: boolean;
  driftDuration: number;
  activeDriftScore: number;
  totalStyleScore: number;
  comboMultiplier: number;
  comboTimer: number;
  boostEnergy: number; // 0..100
  isBoosting: boolean;
  padBoostTimer: number;
  slipstreamIntensity: number; // 0..1
  gear: number; // 1..6 (0 for R)
  rpm: number; // 0..1
  pitch: number; // visual body pitch
  roll: number; // visual body roll
  suspensionBounce: number;
  surface: SurfaceType;
  hitFlashTimer: number;
  featureCooldowns: Record<string, number>;
  // Track & race progress
  trackIndex: number;
  trackS: number;
  lateralOffset: number;
  lap: number; // 1-based current lap
  checkpointMask: number;
  lastCheckpointIndex: number;
  totalProgress: number;
  wrongWay: boolean;
  finished: boolean;
  finishTime: number | null;
  lapStartTime: number;
  bestLapTime: number | null;
  lastLapTime: number | null;
}

export interface RivalController {
  id: string;
  name: string;
  archetype: RivalArchetype;
  colorHex: string;
  accentHex: string;
  basePace: number;
  preferredLane: number;
  aggression: number;
  boostCooldown: number;
  overtakeOffset: number;
  overtakeTimer: number;
}

export interface RaceEvent {
  type:
    | 'checkpoint'
    | 'lap-complete'
    | 'race-finish'
    | 'car-bump'
    | 'barrier-hit'
    | 'boost-ignite'
    | 'drift-bank'
    | 'boost-pad'
    | 'jump-launch'
    | 'jump-land'
    | 'apex-ring'
    | 'countdown-tick'
    | 'perfect-launch';
  intensity: number;
  label?: string;
  points?: number;
}

export interface RaceWorldState {
  courseId: CourseId;
  mode: GameMode;
  tuning: TuningClass;
  totalLaps: number;
  elapsedTime: number;
  countdownTimer: number; // > 0 during 3..2..1 start lights
  lastCountdownDigit: number;
  launchChecked: boolean;
  hitstopTimer: number;
  cameraTrauma: number;
  player: CarState;
  rivals: CarState[];
  rivalControllers: RivalController[];
  standings: string[];
  bannerText: string | null;
  bannerTone: 'amber' | 'cyan' | 'emerald' | 'red';
  bannerTimer: number;
  events: RaceEvent[];
}

export interface HudTelemetry {
  speedKmh: number;
  gear: number;
  rpm: number;
  boostEnergy: number;
  isBoosting: boolean;
  isDrifting: boolean;
  airborne: boolean;
  activeDriftScore: number;
  totalStyleScore: number;
  comboMultiplier: number;
  comboTimer: number;
  slipstream: number;
  position: number;
  totalRacers: number;
  lap: number;
  totalLaps: number;
  lapProgress: number;
  elapsedTime: number;
  currentLapTime: number;
  bestLapTime: number | null;
  countdownDigit: number; // 3, 2, 1, or 0
  wrongWay: boolean;
  bannerText: string | null;
  bannerTone: 'amber' | 'cyan' | 'emerald' | 'red';
  cameraMode: CameraMode;
  mode: GameMode;
  minimapRacers: Array<{
    id: string;
    x: number;
    z: number;
    heading: number;
    isPlayer: boolean;
    colorHex: string;
  }>;
}

export interface RunSnapshot {
  courseId: CourseId;
  courseName: string;
  mode: GameMode;
  position: number;
  totalRacers: number;
  totalTime: number;
  bestLapTime: number | null;
  totalStyleScore: number;
  topSpeedKmh: number;
  isVictory: boolean;
}

export interface LiveryConfig {
  id: string;
  name: string;
  bodyColor: string;
  accentColor: string;
  stripeStyle: 'twin' | 'chevron' | 'horizon' | 'split' | 'carbon';
  paintFinish: PaintFinish;
  rimFinish: RimFinish;
  racingNumber: string;
  tuning: TuningClass;
}
