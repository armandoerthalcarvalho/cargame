import { TUNING_SPECS } from './courses';
import { projectToTrack, sampleTrackAtDistance } from './track';
import type { TrackData } from './track';
import type { CarState, InputState, PhysicsEvent, SurfaceType, TuningClass } from './types';

export const PHYSICS_CONSTANTS = {
  maxDt: 0.05,
  maxSpeed: 64, // m/s (~230 km/h normal top speed)
  boostMaxSpeed: 82, // m/s (~295 km/h during Solar Overdrive)
  maxReverseSpeed: -16, // m/s
  engineAccel: 31, // m/s^2
  boostAccel: 28, // additional m/s^2
  brakeDecel: 48, // m/s^2
  coastDrag: 0.11,
  rollingFriction: 2.7,
  shoulderDrag: 0.48,
  baseTurnRate: 2.38, // rad/s at optimal speed
  driftTurnBoost: 1.4,
  gripLateralDamp: 8.6,
  driftLateralDamp: 2.1,
  driftBoostChargeRate: 21, // boost energy per second during active drift
  boostBurnRate: 28, // boost energy per second while boosting
  passiveBoostRegen: 2.6, // gentle recharge per second while driving fast
  minBoostToIgnite: 15,
  driftMinSpeed: 15, // m/s required to sustain a drift
  gravity: 28, // m/s^2 vertical gravity during ramp jumps
  comboDuration: 5.0, // seconds before stunt combo multiplier resets
};

export function headingToForward(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/**
 * Right-handed screen-right vector for a chase camera behind the car.
 * forward = (sin h, 0, cos h), up = (0, 1, 0) => right = forward x up = (-cos h, 0, sin h)
 */
export function headingToRight(heading: number): { x: number; z: number } {
  return { x: -Math.cos(heading), z: Math.sin(heading) };
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function computeGearAndRpm(speedMs: number): { gear: number; rpm: number } {
  if (speedMs < -0.5) {
    return { gear: 0, rpm: Math.min(1, Math.abs(speedMs) / 16) };
  }
  const absSpeed = Math.max(0, speedMs);
  const thresholds = [0, 13, 25, 37, 50, 63, 86];
  for (let g = 1; g <= 6; g++) {
    if (absSpeed <= thresholds[g] || g === 6) {
      const low = thresholds[g - 1];
      const high = thresholds[g];
      const frac = Math.max(0, Math.min(1, (absSpeed - low) / Math.max(1, high - low)));
      const rpm = g === 1 ? 0.18 + frac * 0.82 : 0.36 + frac * 0.64;
      return { gear: g, rpm: Math.min(1, rpm) };
    }
  }
  return { gear: 6, rpm: 1 };
}

export function createInitialCarState(
  track: TrackData,
  opts: {
    id: string;
    name: string;
    racingNumber?: string;
    vehicleModel?: string;
    specialty?: string;
    isPlayer: boolean;
    colorHex: string;
    accentHex: string;
    startS: number;
    lateralOffset: number;
    modifiers?: CarState['modifiers'];
  },
): CarState {
  const sample = sampleTrackAtDistance(track, opts.startS);
  const x = sample.pos.x + sample.right.x * opts.lateralOffset;
  const z = sample.pos.z + sample.right.z * opts.lateralOffset;
  const y = sample.pos.y + Math.sin(sample.bankAngle) * opts.lateralOffset;
  const heading = Math.atan2(sample.tangent.x, sample.tangent.z);

  return {
    id: opts.id,
    name: opts.name,
    racingNumber: opts.racingNumber ?? '07',
    vehicleModel: opts.vehicleModel ?? 'Solstice GT',
    specialty: opts.specialty ?? 'Grand Tourer',
    isPlayer: opts.isPlayer,
    colorHex: opts.colorHex,
    accentHex: opts.accentHex,
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    groundY: y,
    airborne: false,
    airtime: 0,
    modifiers: opts.modifiers,
    heading,
    speed: 0,
    angularVelocity: 0,
    steerAngle: 0,
    wheelSpin: 0,
    driftAngle: 0,
    isDrifting: false,
    driftDuration: 0,
    activeDriftScore: 0,
    totalStyleScore: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    boostEnergy: 50,
    isBoosting: false,
    padBoostTimer: 0,
    slipstreamIntensity: 0,
    gear: 1,
    rpm: 0.18,
    pitch: 0,
    roll: 0,
    suspensionBounce: 0,
    surface: 'asphalt',
    hitFlashTimer: 0,
    featureCooldowns: {},
    trackIndex: sample.index,
    trackS: sample.s,
    lateralOffset: opts.lateralOffset,
    lap: 1,
    checkpointMask: 0,
    lastCheckpointIndex: 0,
    totalProgress: 0,
    wrongWay: false,
    finished: false,
    finishTime: null,
    lapStartTime: 0,
    bestLapTime: null,
    lastLapTime: null,
  };
}

function awardStylePoints(car: CarState, basePoints: number, bumpCombo: boolean): number {
  if (bumpCombo) {
    car.comboMultiplier = Math.min(5, car.comboMultiplier + 1);
  }
  car.comboTimer = PHYSICS_CONSTANTS.comboDuration;
  const awarded = Math.round(basePoints * car.comboMultiplier);
  car.totalStyleScore += awarded;
  return awarded;
}

export function stepVehiclePhysics(
  car: CarState,
  rawInput: InputState,
  track: TrackData,
  rawDt: number,
  paceMultiplier = 1,
  tuning: TuningClass = 'balanced',
): PhysicsEvent[] {
  const dt = Math.max(0, Math.min(rawDt, PHYSICS_CONSTANTS.maxDt));
  if (dt <= 0) return [];

  const events: PhysicsEvent[] = [];
  const spec = TUNING_SPECS[tuning];
  const mods = car.modifiers;
  const topSpeedMult = spec.topSpeedMult * (mods?.topSpeedMult ?? 1);
  const accelMult = spec.accelMult * (mods?.accelMult ?? 1);
  const gripMult = spec.driftGripMult * (mods?.gripMult ?? 1);
  const boostChargeMult = spec.boostChargeMult * (mods?.driftChargeMult ?? 1);
  const brakeMult = mods?.brakeMult ?? 1;
  const boostPowerMult = mods?.boostPowerMult ?? 1;

  const throttle = Math.max(0, Math.min(1, rawInput.throttle));
  const brake = Math.max(0, Math.min(1, rawInput.brake));
  const steer = Math.max(-1, Math.min(1, rawInput.steer));

  // Decay timers
  if (car.hitFlashTimer > 0) {
    car.hitFlashTimer = Math.max(0, car.hitFlashTimer - dt);
  }
  if (car.padBoostTimer > 0) {
    car.padBoostTimer = Math.max(0, car.padBoostTimer - dt);
  }
  if (car.comboTimer > 0) {
    car.comboTimer = Math.max(0, car.comboTimer - dt);
    if (car.comboTimer === 0 && !car.isDrifting && !car.airborne) {
      car.comboMultiplier = 1;
    }
  }
  if (Math.abs(car.suspensionBounce) > 0.001) {
    car.suspensionBounce *= Math.exp(-9 * dt);
  } else {
    car.suspensionBounce = 0;
  }

  for (const featId of Object.keys(car.featureCooldowns)) {
    const remaining = car.featureCooldowns[featId] - dt;
    if (remaining <= 0) {
      delete car.featureCooldowns[featId];
    } else {
      car.featureCooldowns[featId] = remaining;
    }
  }

  // Forward & right basis vectors
  const fwd = headingToForward(car.heading);
  const right = headingToRight(car.heading);

  // Decompose current velocity into local forward and lateral components
  let forwardVel = car.vx * fwd.x + car.vz * fwd.z;
  let lateralVel = car.vx * right.x + car.vz * right.z;

  // Boost activation and consumption (manual boost or active boost-pad overdrive)
  const wantsBoost = rawInput.boost && throttle > 0.05;
  if (wantsBoost && !car.isBoosting && car.boostEnergy >= PHYSICS_CONSTANTS.minBoostToIgnite) {
    car.isBoosting = true;
    events.push({ type: 'boost-ignite', intensity: 1 });
  }
  const manualBoostActive = car.isBoosting && rawInput.boost && car.boostEnergy > 0.5 && brake <= 0.3;
  if (car.isBoosting && !manualBoostActive) {
    car.isBoosting = false;
  }
  if (car.isBoosting) {
    car.boostEnergy = Math.max(0, car.boostEnergy - PHYSICS_CONSTANTS.boostBurnRate * dt);
  } else if (forwardVel > 24 && car.surface === 'asphalt' && !car.airborne) {
    car.boostEnergy = Math.min(
      100,
      car.boostEnergy + PHYSICS_CONSTANTS.passiveBoostRegen * boostChargeMult * dt,
    );
  }

  const boostEffective = car.isBoosting || car.padBoostTimer > 0;

  // Slipstream adds subtle top-speed bonus and charges boost
  const slipBonus = car.slipstreamIntensity * 7.5;
  if (car.slipstreamIntensity > 0.15) {
    car.boostEnergy = Math.min(100, car.boostEnergy + car.slipstreamIntensity * 9 * dt);
  }

  const baseTopSpeed = (boostEffective ? PHYSICS_CONSTANTS.boostMaxSpeed : PHYSICS_CONSTANTS.maxSpeed) * topSpeedMult;
  const padBonus = car.padBoostTimer > 0 ? 5.5 : 0;
  const effectiveMaxSpeed = (baseTopSpeed + slipBonus + padBonus) * paceMultiplier;

  // Longitudinal acceleration / braking / reverse
  let longAccel = 0;
  if (!car.airborne) {
    if (throttle > 0) {
      const speedRatio = Math.max(0, forwardVel) / Math.max(1, effectiveMaxSpeed);
      const torqueCurve = Math.max(0.38, 1.22 - speedRatio * 0.78);
      longAccel += throttle * PHYSICS_CONSTANTS.engineAccel * accelMult * torqueCurve * paceMultiplier;
    }
    if (boostEffective) {
      longAccel += PHYSICS_CONSTANTS.boostAccel * boostPowerMult * paceMultiplier;
    }
    if (brake > 0) {
      if (forwardVel > 1.2) {
        longAccel -= brake * PHYSICS_CONSTANTS.brakeDecel * brakeMult;
      } else {
        longAccel -= brake * 16;
      }
    }
  } else if (boostEffective) {
    // Mid-air thruster nudge feels awesome off ramps
    longAccel += PHYSICS_CONSTANTS.boostAccel * 0.35 * boostPowerMult;
  }

  // Aerodynamic + rolling + surface drag
  const surfaceExtraDrag = !car.airborne && car.surface === 'shoulder' ? PHYSICS_CONSTANTS.shoulderDrag : 0;
  const dragSign = forwardVel > 0 ? 1 : forwardVel < 0 ? -1 : 0;
  const aeroDrag =
    (PHYSICS_CONSTANTS.coastDrag + surfaceExtraDrag) *
    (forwardVel * Math.abs(forwardVel)) *
    (car.airborne ? 0.006 : 0.015);
  const rollDrag = car.airborne
    ? 0
    : throttle < 0.05 && brake < 0.05
      ? dragSign * PHYSICS_CONSTANTS.rollingFriction * 1.45
      : dragSign * PHYSICS_CONSTANTS.rollingFriction * 0.35;

  forwardVel += (longAccel - aeroDrag - rollDrag) * dt;

  // Snap tiny residual speed to zero when no input is held
  if (!car.airborne && throttle < 0.01 && brake < 0.01 && Math.abs(forwardVel) < 0.18) {
    forwardVel = 0;
    lateralVel *= 0.5;
  }

  // Clamp longitudinal velocity
  forwardVel = Math.max(PHYSICS_CONSTANTS.maxReverseSpeed, Math.min(effectiveMaxSpeed, forwardVel));

  // Drift state detection & steering dynamics
  const absSpeed = Math.abs(forwardVel);
  const canDrift =
    !car.airborne &&
    rawInput.drift &&
    forwardVel > PHYSICS_CONSTANTS.driftMinSpeed &&
    (Math.abs(steer) > 0.15 || Math.abs(lateralVel) > 4.2);

  if (canDrift) {
    car.isDrifting = true;
    car.driftDuration += dt;
    car.comboTimer = PHYSICS_CONSTANTS.comboDuration;
  } else {
    if (car.isDrifting && car.activeDriftScore >= 25) {
      const banked = awardStylePoints(car, car.activeDriftScore, car.activeDriftScore >= 120);
      events.push({
        type: 'drift-bank',
        intensity: Math.min(1, banked / 450),
        points: banked,
        label: `DRIFT +${banked}`,
      });
    }
    car.isDrifting = false;
    car.driftDuration = 0;
    car.activeDriftScore = 0;
  }

  // Speed-sensitive steering response (reduced mid-air)
  const speedSteerFactor =
    absSpeed < 1.0
      ? absSpeed
      : Math.max(0.46, 1.06 - (absSpeed / PHYSICS_CONSTANTS.boostMaxSpeed) * 0.5);
  const reverseSign = forwardVel >= -0.2 ? 1 : -1;
  const turnMult = car.airborne ? 0.22 : car.isDrifting ? PHYSICS_CONSTANTS.driftTurnBoost : 1.0;

  const targetAngVel = steer * PHYSICS_CONSTANTS.baseTurnRate * speedSteerFactor * turnMult * reverseSign;
  const angBlend = 1 - Math.exp(-11 * dt);
  car.angularVelocity += (targetAngVel - car.angularVelocity) * angBlend;

  // Apply yaw rotation
  const dHeading = car.angularVelocity * dt;
  car.heading = normalizeAngle(car.heading + dHeading);

  if (car.isDrifting) {
    lateralVel += -steer * Math.min(18, forwardVel * 0.34) * dt * 2.2;
    if (!boostEffective) {
      forwardVel *= 1 - 0.13 * dt;
    }
  }

  // Lateral grip damping (modified by tuning class and per-car profile)
  const lateralDamp = car.airborne
    ? 0.55
    : car.isDrifting
      ? PHYSICS_CONSTANTS.driftLateralDamp * gripMult
      : car.surface === 'shoulder'
        ? PHYSICS_CONSTANTS.gripLateralDamp * 0.65 * gripMult
        : PHYSICS_CONSTANTS.gripLateralDamp * gripMult;
  lateralVel *= Math.exp(-lateralDamp * dt);
  lateralVel = Math.max(-24, Math.min(24, lateralVel));

  // Accumulate drift score & boost charge while sliding
  if (car.isDrifting && Math.abs(lateralVel) > 2.2) {
    const slipQuality = Math.min(1.85, Math.abs(lateralVel) / 7.5) * (forwardVel / 42);
    car.activeDriftScore += slipQuality * 150 * dt;
    car.boostEnergy = Math.min(
      100,
      car.boostEnergy +
        PHYSICS_CONSTANTS.driftBoostChargeRate * spec.boostChargeMult * Math.min(1.4, slipQuality) * dt,
    );
  }

  // Reconstruct world velocity from updated heading
  const newFwd = headingToForward(car.heading);
  const newRight = headingToRight(car.heading);
  car.vx = newFwd.x * forwardVel + newRight.x * lateralVel;
  car.vz = newFwd.z * forwardVel + newRight.z * lateralVel;

  // Integrate horizontal position
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // Project onto track corridor for elevation, surface type, and guardrail containment
  const proj = projectToTrack(track, car.x, car.z, car.trackIndex);
  const halfAsphalt = track.course.roadWidth * 0.5;
  const barrierLimit = halfAsphalt + track.course.shoulderWidth - 1.25;

  let surface: SurfaceType = 'asphalt';
  const absLat = Math.abs(proj.lateral);
  if (absLat > halfAsphalt + 0.5) {
    surface = 'shoulder';
  } else if (absLat > halfAsphalt - 0.85) {
    surface = 'curb';
  }
  car.surface = surface;

  let groundY = proj.roadY;

  // Guardrail containment: keep vehicle cleanly inside the track corridor with realistic scrape bounce
  if (absLat > barrierLimit) {
    const sign = proj.lateral >= 0 ? 1 : -1;
    const clampedLat = sign * barrierLimit;
    car.x = proj.sample.pos.x + proj.sample.right.x * clampedLat;
    car.z = proj.sample.pos.z + proj.sample.right.z * clampedLat;

    const outVel = (car.vx * proj.sample.right.x + car.vz * proj.sample.right.z) * sign;
    if (outVel > 0) {
      const impact = Math.min(1, outVel / 18);
      car.vx -= proj.sample.right.x * sign * outVel * 1.25;
      car.vz -= proj.sample.right.z * sign * outVel * 1.25;
      const scrub = 1 - Math.min(0.22, impact * 0.2);
      car.vx *= scrub;
      car.vz *= scrub;

      const tangentHeading = Math.atan2(proj.sample.tangent.x, proj.sample.tangent.z);
      const headingDelta = normalizeAngle(tangentHeading - car.heading);
      if (Math.abs(headingDelta) < Math.PI * 0.65) {
        car.heading = normalizeAngle(car.heading + headingDelta * Math.min(0.35, 0.12 + impact * 0.2));
      }

      if (impact > 0.16) {
        car.hitFlashTimer = 0.08;
        events.push({ type: 'barrier-hit', intensity: impact });
      }
    }

    if (outVel > 8.5 && car.isDrifting) {
      car.isDrifting = false;
      car.activeDriftScore = 0;
    }

    car.lateralOffset = clampedLat;
    groundY = proj.sample.pos.y + Math.sin(proj.sample.bankAngle) * clampedLat;
  } else {
    car.lateralOffset = proj.lateral;
    groundY = proj.roadY;
  }

  car.groundY = groundY;

  // 3D Airborne Physics (Jump Ramps & Gravity)
  if (car.airborne) {
    car.y += car.vy * dt;
    car.vy -= PHYSICS_CONSTANTS.gravity * dt;
    car.airtime += dt;
    car.comboTimer = PHYSICS_CONSTANTS.comboDuration;

    if (car.y <= groundY) {
      car.y = groundY;
      car.vy = 0;
      car.airborne = false;
      car.suspensionBounce = -0.22;
      if (car.airtime >= 0.32) {
        const airPts = awardStylePoints(car, Math.round(car.airtime * 175), car.airtime >= 0.65);
        car.boostEnergy = Math.min(100, car.boostEnergy + Math.min(24, car.airtime * 18));
        events.push({
          type: 'jump-land',
          intensity: Math.min(1, car.airtime / 1.4),
          points: airPts,
          label: `AIRTIME +${airPts}`,
        });
      }
      car.airtime = 0;
    }
  } else {
    car.y = groundY;
    car.vy = 0;
  }

  // Interactive Track Features (Boost Pads, Jump Ramps, Apex Rings)
  const finalFwd = headingToForward(car.heading);
  const finalRight = headingToRight(car.heading);
  car.speed = car.vx * finalFwd.x + car.vz * finalFwd.z;

  for (const feat of track.features) {
    if (car.featureCooldowns[feat.id]) continue;
    const dx = car.x - feat.pos.x;
    const dz = car.z - feat.pos.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > feat.radius * feat.radius) continue;

    if (feat.type === 'boost-pad' && !car.airborne) {
      car.featureCooldowns[feat.id] = 1.6;
      car.padBoostTimer = 1.15;
      car.boostEnergy = Math.min(100, car.boostEnergy + 24);
      const targetSurge = Math.min(effectiveMaxSpeed + 6, Math.max(car.speed + 15, 58));
      const latComp = car.vx * finalRight.x + car.vz * finalRight.z;
      car.vx = finalFwd.x * targetSurge + finalRight.x * latComp;
      car.vz = finalFwd.z * targetSurge + finalRight.z * latComp;
      car.speed = targetSurge;
      const pts = awardStylePoints(car, 100, false);
      events.push({
        type: 'boost-pad',
        intensity: 1,
        points: pts,
        label: `TURBO PAD +${pts}`,
      });
    } else if (feat.type === 'jump-ramp' && !car.airborne && car.speed > 14) {
      car.featureCooldowns[feat.id] = 1.6;
      car.airborne = true;
      car.airtime = 0;
      car.vy = Math.min(17.5, 9.0 + car.speed * 0.135);
      car.y = groundY + 0.35;
      car.isDrifting = false;
      events.push({
        type: 'jump-launch',
        intensity: Math.min(1, car.speed / 65),
        label: 'LAUNCH!',
      });
    } else if (feat.type === 'apex-ring') {
      car.featureCooldowns[feat.id] = 1.8;
      car.boostEnergy = Math.min(100, car.boostEnergy + 22);
      const pts = awardStylePoints(car, 150, true);
      events.push({
        type: 'apex-ring',
        intensity: 0.9,
        points: pts,
        label: `APEX ×${car.comboMultiplier} +${pts}`,
      });
    }
  }

  // Update derived kinematic & visual animation telemetry
  const finalLat = car.vx * finalRight.x + car.vz * finalRight.z;
  car.driftAngle = Math.atan2(finalLat, Math.max(8, Math.abs(car.speed)));
  car.steerAngle += (steer * 0.48 - car.steerAngle) * (1 - Math.exp(-14 * dt));
  car.wheelSpin += (car.speed / 0.36) * dt;

  // Suspension pitch (squat under throttle, airborne tilt during jumps) and body roll
  const targetPitch = car.airborne
    ? Math.max(-0.24, Math.min(0.24, -car.vy * 0.014))
    : Math.max(-0.06, Math.min(0.06, -(longAccel / 520)));
  const targetRoll = car.airborne
    ? 0
    : Math.max(-0.08, Math.min(0.08, -car.angularVelocity * (absSpeed / 58) * 0.045));
  car.pitch += (targetPitch - car.pitch) * (1 - Math.exp(-10 * dt));
  car.roll += (targetRoll - car.roll) * (1 - Math.exp(-10 * dt));

  const { gear, rpm } = computeGearAndRpm(car.speed);
  car.gear = gear;
  car.rpm = rpm;

  car.trackIndex = proj.sampleIndex;
  car.trackS = proj.s;

  // Wrong-way check: facing > 110 deg opposite track tangent while moving
  const dotTangent = finalFwd.x * proj.sample.tangent.x + finalFwd.z * proj.sample.tangent.z;
  car.wrongWay = dotTangent < -0.35 && car.speed > 3;

  return events;
}
