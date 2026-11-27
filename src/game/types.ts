export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type GameMode = 'grand-prix' | 'time-trial' | 'free-roam';

export type CameraMode = 'chase' | 'hood' | 'helo';

export type TimeOfDay = 'golden' | 'noon' | 'twilight';

export type PaintFinish = 'gloss' | 'metallic' | 'matte';

export type RimFinish = 'alloy' | 'gold' | 'obsidian' | 'copper';

export type TuningClass = 'balanced' | 'drift' | 'aero';

export type RadioStationId = 'solstice' | 'coastal' | 'velocity' | 'off';

export type SurfaceType = 'asphalt' | 'curb' | 'shoulder';

export type CourseId =
  | 'emerald-oval'
  | 'amber-dunes'
  | 'sunstone-canyon'
  | 'sunken-coast'
  | 'sakura-skyway'
  | 'glacier-observatory'
  | 'redwood-switchbacks'
  | 'obsidian-caldera';

export type CourseDifficulty = 'Easy' | 'Flowing' | 'Balanced' | 'High Speed' | 'Technical' | 'Expert';

export type CourseLengthCategory = 'Short' | 'Medium' | 'Long';

export type TreeStyle =
  | 'juniper'
  | 'cypress'
  | 'pine'
  | 'sakura'
  | 'oak'
  | 'palm'
  | 'sequoia'
  | 'birch';

export type LandmarkStyle =
  | 'canyon-arch'
  | 'limestone-viaduct'
  | 'observatory-dome'
  | 'sakura-torii'
  | 'meadow-windmill'
  | 'desert-obelisk'
  | 'redwood-viaduct'
  | 'basalt-caldera';

export type RivalArchetype =
  | 'apex-purist'
  | 'drift-maverick'
  | 'slipstream-hunter'
  | 'aero-demon'
  | 'launch-rocket'
  | 'late-braker'
  | 'canyon-daredevil'
  | 'endurance-metronome'
  | 'defensive-guard'
  | 'boost-sprinter'
  | 'alpine-climber';

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

export type TrackFeatureType = 'boost-pad' | 'jump-ramp' | 'apex-ring';

export interface TrackFeatureSpec {
  id: string;
  type: TrackFeatureType;
  /** Normalized loop position [0, 1) */
  t: number;
  /** Lateral offset from centerline in meters */
  lateral: number;
}

export interface TrackFeatureInstance {
  id: string;
  type: TrackFeatureType;
  s: number;
  lateral: number;
  pos: Vec3;
  heading: number;
  bankAngle: number;
  radius: number;
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

export interface CourseTheme {
  id: CourseId;
  name: string;
  region: string;
  tagline: string;
  difficulty: CourseDifficulty;
  lengthCategory: CourseLengthCategory;
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
  treeStyle: TreeStyle;
  landmarkStyle: LandmarkStyle;
  controlPoints: ControlPoint[];
  features: TrackFeatureSpec[];
}

export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (right) .. +1 (left)
  drift: boolean;
  boost: boolean;
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

export interface VehicleModifiers {
  topSpeedMult: number;
  accelMult: number;
  gripMult: number;
  driftChargeMult: number;
  brakeMult: number;
  boostPowerMult: number;
}

export interface RivalProfile {
  id: string;
  name: string;
  vehicleModel: string;
  specialty: string;
  strengthNote: string;
  archetype: RivalArchetype;
  livery: LiveryConfig;
  modifiers: VehicleModifiers;
  basePace: number;
  preferredLane: number;
  aggression: number;
  defensiveBias: number;
  driftAffinity: number;
  boostThreshold: number;
}

export interface PhysicsEvent {
  type:
    | 'barrier-hit'
    | 'drift-bank'
    | 'boost-ignite'
    | 'boost-pad'
    | 'jump-launch'
    | 'jump-land'
    | 'apex-ring';
  intensity: number;
  points?: number;
  label?: string;
}

export interface RaceEvent {
  type:
    | 'countdown-tick'
    | 'perfect-launch'
    | 'checkpoint'
    | 'lap-complete'
    | 'race-finish'
    | 'barrier-hit'
    | 'car-bump'
    | 'post-hit'
    | 'drift-bank'
    | 'boost-ignite'
    | 'boost-pad'
    | 'jump-launch'
    | 'jump-land'
    | 'apex-ring';
  intensity: number;
  points?: number;
  label?: string;
  x?: number;
  y?: number;
  z?: number;
}

export interface CarState {
  id: string;
  name: string;
  racingNumber: string;
  vehicleModel: string;
  specialty: string;
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
  /** Yaw in radians: 0 points along +Z, +PI/2 points along +X */
  heading: number;
  speed: number;
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
  gear: number;
  rpm: number; // 0..1
  pitch: number;
  roll: number;
  suspensionBounce: number;
  surface: SurfaceType;
  hitFlashTimer: number;
  featureCooldowns: Record<string, number>;
  trackIndex: number;
  trackS: number; // distance along track loop [0, totalLength)
  lateralOffset: number;
  lap: number; // 1-indexed
  checkpointMask: number;
  lastCheckpointIndex: number;
  totalProgress: number;
  wrongWay: boolean;
  finished: boolean;
  finishTime: number | null;
  lapStartTime: number;
  bestLapTime: number | null;
  lastLapTime: number | null;
  modifiers?: VehicleModifiers;
}

export interface RivalController {
  id: string;
  name: string;
  racingNumber: string;
  vehicleModel: string;
  specialty: string;
  archetype: RivalArchetype;
  livery: LiveryConfig;
  modifiers: VehicleModifiers;
  colorHex: string;
  accentHex: string;
  basePace: number;
  preferredLane: number;
  aggression: number;
  defensiveBias: number;
  driftAffinity: number;
  boostThreshold: number;
  boostCooldown: number;
  overtakeOffset: number;
  overtakeTimer: number;
}

export interface RoadsidePostState {
  id: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  baseYaw: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vrz: number;
  knocked: boolean;
  settled: boolean;
  hitCooldown: number;
}

export interface RaceWorldState {
  courseId: CourseId;
  mode: GameMode;
  tuning: TuningClass;
  totalLaps: number;
  elapsedTime: number;
  countdownTimer: number;
  lastCountdownDigit: number;
  launchChecked: boolean;
  hitstopTimer: number;
  cameraTrauma: number;
  player: CarState;
  rivals: CarState[];
  rivalControllers: RivalController[];
  posts: RoadsidePostState[];
  standings: string[];
  bannerText: string | null;
  bannerTone: 'amber' | 'emerald' | 'cyan' | 'rose';
  bannerTimer: number;
  events: RaceEvent[];
}

export interface MinimapRacer {
  id: string;
  x: number;
  z: number;
  heading: number;
  isPlayer: boolean;
  colorHex: string;
}

export interface StandingsEntry {
  position: number;
  id: string;
  name: string;
  racingNumber: string;
  vehicleModel: string;
  specialty: string;
  colorHex: string;
  accentHex: string;
  isPlayer: boolean;
  finished: boolean;
  finishTime: number | null;
  gapMeters: number;
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
  countdownDigit: number;
  wrongWay: boolean;
  bannerText: string | null;
  bannerTone: 'amber' | 'emerald' | 'cyan' | 'rose';
  cameraMode: CameraMode;
  mode: GameMode;
  minimapRacers: MinimapRacer[];
  standingsTable: StandingsEntry[];
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
  standingsTable: StandingsEntry[];
}
