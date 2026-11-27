import { TUNING_SPECS } from './courses';
import {
  createInitialCarState,
  headingToForward,
  normalizeAngle,
  stepVehiclePhysics,
} from './physics';
import { createRoadsidePosts, stepRoadsidePosts } from './posts';
import { RIVAL_PROFILES } from './rivals';
import { sampleTrackAtDistance, wrapDistance } from './track';
import type { TrackData } from './track';
import type {
  CarState,
  GameMode,
  InputState,
  RaceEvent,
  RaceWorldState,
  RivalController,
  RunSnapshot,
  StandingsEntry,
  TuningClass,
} from './types';

/**
 * 12-car staggered 2x6 FIA starting grid layout (P1 at s = 82m down to P12 at s = 5m).
 * Keeps all 12 cars cleanly behind the s = 90m starting lights gantry with >= 7.8m separation.
 */
const GRID_SLOTS_12: ReadonlyArray<{ s: number; lat: number }> = [
  { s: 82, lat: -2.65 }, // P1
  { s: 75, lat: 2.65 },  // P2
  { s: 68, lat: -2.65 }, // P3
  { s: 61, lat: 2.65 },  // P4
  { s: 54, lat: -2.65 }, // P5
  { s: 47, lat: 2.65 },  // P6
  { s: 40, lat: -2.65 }, // P7
  { s: 33, lat: 2.65 },  // P8
  { s: 26, lat: -2.65 }, // P9
  { s: 19, lat: 2.65 },  // P10 (Player in Grand Prix: 9 distinct cars ahead + 2 right behind!)
  { s: 12, lat: -2.65 }, // P11
  { s: 5, lat: 2.65 },   // P12
];

const PLAYER_GP_GRID_INDEX = 9; // Starts P10 of 12 for immediate multi-car overtakes & mirror battles

export function createRaceWorld(
  track: TrackData,
  mode: GameMode,
  playerColors: {
    bodyColor: string;
    accentColor: string;
    racingNumber?: string;
    vehicleModel?: string;
  },
  opts?: { tuning?: TuningClass; skipCountdown?: boolean },
): RaceWorldState {
  const tuning: TuningClass = opts?.tuning ?? 'balanced';
  const tuningLabel = TUNING_SPECS[tuning].label;

  const playerSlot =
    mode === 'grand-prix'
      ? GRID_SLOTS_12[PLAYER_GP_GRID_INDEX]
      : { s: 40, lat: 0 };

  const player = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    racingNumber: playerColors.racingNumber ?? '07',
    vehicleModel: playerColors.vehicleModel ?? 'Solstice GT',
    specialty: tuningLabel,
    isPlayer: true,
    colorHex: playerColors.bodyColor,
    accentHex: playerColors.accentColor,
    startS: wrapDistance(playerSlot.s, track.totalLength),
    lateralOffset: playerSlot.lat,
  });
  player.totalProgress = player.trackS;

  const rivals: CarState[] = [];
  const rivalControllers: RivalController[] = [];

  if (mode === 'grand-prix') {
    const rivalSlots = GRID_SLOTS_12.filter((_, idx) => idx !== PLAYER_GP_GRID_INDEX);

    RIVAL_PROFILES.forEach((profile, idx) => {
      const slot = rivalSlots[idx];
      const car = createInitialCarState(track, {
        id: profile.id,
        name: profile.name,
        racingNumber: profile.livery.racingNumber,
        vehicleModel: profile.vehicleModel,
        specialty: profile.specialty,
        isPlayer: false,
        colorHex: profile.livery.bodyColor,
        accentHex: profile.livery.accentColor,
        startS: wrapDistance(slot.s, track.totalLength),
        lateralOffset: slot.lat,
        modifiers: profile.modifiers,
      });
      car.totalProgress = car.trackS;

      rivals.push(car);
      rivalControllers.push({
        id: profile.id,
        name: profile.name,
        racingNumber: profile.livery.racingNumber,
        vehicleModel: profile.vehicleModel,
        specialty: profile.specialty,
        archetype: profile.archetype,
        livery: profile.livery,
        modifiers: profile.modifiers,
        colorHex: profile.livery.bodyColor,
        accentHex: profile.livery.accentColor,
        basePace: profile.basePace,
        preferredLane: profile.preferredLane,
        aggression: profile.aggression,
        defensiveBias: profile.defensiveBias,
        driftAffinity: profile.driftAffinity,
        boostThreshold: profile.boostThreshold,
        boostCooldown: 2.2 + (idx % 5) * 1.1,
        overtakeOffset: 0,
        overtakeTimer: 0,
      });
    });
  }

  const all = [player, ...rivals];
  const standings = [...all]
    .sort((a, b) => b.totalProgress - a.totalProgress)
    .map((c) => c.id);

  const shouldCountdown = !opts?.skipCountdown && mode !== 'free-roam';

  return {
    courseId: track.course.id,
    mode,
    tuning,
    totalLaps: mode === 'free-roam' ? 99 : track.course.totalLaps,
    elapsedTime: 0,
    countdownTimer: shouldCountdown ? 3.15 : 0,
    lastCountdownDigit: shouldCountdown ? 4 : 0,
    launchChecked: !shouldCountdown,
    hitstopTimer: 0,
    cameraTrauma: 0,
    player,
    rivals,
    rivalControllers,
    posts: createRoadsidePosts(track),
    standings,
    bannerText: null,
    bannerTone: 'amber',
    bannerTimer: 0,
    events: [],
  };
}

/**
 * Instantly resets a car back onto the track centerline facing cleanly forward.
 * Triggered by the T key so players can recover instantly from any spin or off-line slide.
 */
export function resetCarToTrack(car: CarState, track: TrackData): void {
  const sample = sampleTrackAtDistance(track, car.trackS);
  car.x = sample.pos.x;
  car.y = sample.pos.y;
  car.z = sample.pos.z;
  car.groundY = sample.pos.y;
  car.vx = 0;
  car.vy = 0;
  car.vz = 0;
  car.speed = 0;
  car.airborne = false;
  car.airtime = 0;
  car.angularVelocity = 0;
  car.heading = Math.atan2(sample.tangent.x, sample.tangent.z);
  car.lateralOffset = 0;
  car.isDrifting = false;
  car.activeDriftScore = 0;
  car.wrongWay = false;
  car.pitch = 0;
  car.roll = 0;
  car.suspensionBounce = -0.1;
}

export function computeRivalInput(
  car: CarState,
  ctrl: RivalController,
  allCars: CarState[],
  track: TrackData,
  dt: number,
): InputState {
  const halfRoad = track.course.roadWidth * 0.5 - 2.1;

  // Archetype-tuned lookahead horizon
  const lookAheadFactor =
    ctrl.archetype === 'apex-purist' || ctrl.archetype === 'endurance-metronome'
      ? 0.68
      : ctrl.archetype === 'late-braker' || ctrl.archetype === 'alpine-climber'
        ? 0.56
        : ctrl.archetype === 'drift-maverick' || ctrl.archetype === 'canyon-daredevil'
          ? 0.52
          : 0.61;
  const lookAheadDist = Math.max(18, car.speed * lookAheadFactor);

  const nearSample = sampleTrackAtDistance(track, car.trackS + 14);
  const farSample = sampleTrackAtDistance(track, car.trackS + lookAheadDist);
  const curveAhead = sampleTrackAtDistance(
    track,
    car.trackS + Math.max(28, car.speed * (ctrl.archetype === 'late-braker' ? 0.8 : 0.96)),
  );

  // Detect closest car immediately ahead and behind for realistic pack racing & overtaking
  let carAhead: CarState | null = null;
  let aheadGap = 42;
  let carBehind: CarState | null = null;
  let behindGap = 18;
  for (const other of allCars) {
    if (other.id === car.id) continue;
    const gapFwd = wrapDistance(other.trackS - car.trackS, track.totalLength);
    if (gapFwd > 2.5 && gapFwd < aheadGap) {
      aheadGap = gapFwd;
      carAhead = other;
    }
    const gapBwd = wrapDistance(car.trackS - other.trackS, track.totalLength);
    if (gapBwd > 2.5 && gapBwd < behindGap) {
      behindGap = gapBwd;
      carBehind = other;
    }
  }

  if (ctrl.overtakeTimer > 0) {
    ctrl.overtakeTimer = Math.max(0, ctrl.overtakeTimer - dt);
  }

  let targetLane = ctrl.preferredLane;

  // Distinct racing lines per archetype
  if (ctrl.archetype === 'apex-purist' || ctrl.archetype === 'alpine-climber') {
    const apexPull = Math.max(-halfRoad, Math.min(halfRoad, -farSample.curvature * 195));
    targetLane = apexPull * 0.86;
  } else if (ctrl.archetype === 'drift-maverick' || ctrl.archetype === 'canyon-daredevil') {
    const wideEntry = Math.max(-halfRoad, Math.min(halfRoad, nearSample.curvature * 145));
    targetLane = wideEntry * 0.72 + Math.sin(car.trackS * 0.028 + ctrl.preferredLane) * 1.15;
  } else if (ctrl.archetype === 'slipstream-hunter') {
    if (carAhead && aheadGap < 38) {
      if (aheadGap < 14 && ctrl.overtakeTimer <= 0) {
        ctrl.overtakeOffset = carAhead.lateralOffset >= 0 ? -3.4 : 3.4;
        ctrl.overtakeTimer = 2.4;
      }
      targetLane =
        ctrl.overtakeTimer > 0
          ? carAhead.lateralOffset + ctrl.overtakeOffset
          : carAhead.lateralOffset;
    } else {
      targetLane = -farSample.curvature * 120;
    }
  } else if (ctrl.archetype === 'defensive-guard' && carBehind && behindGap < 14) {
    // Cover the inside line of the upcoming corner or mirror challenger subtly
    const insideDir = farSample.curvature >= 0 ? -1 : 1;
    targetLane = Math.max(-halfRoad * 0.78, Math.min(halfRoad * 0.78, insideDir * 2.4 + carBehind.lateralOffset * 0.35));
  } else {
    // Natural racing line blended with driver's preferred lane
    targetLane = ctrl.preferredLane * 0.42 + Math.max(-halfRoad, Math.min(halfRoad, -farSample.curvature * 135)) * 0.58;
  }

  // Pack-awareness: all 11 rivals cleanly pull out to overtake slower cars directly ahead!
  if (carAhead && aheadGap < 14 && Math.abs(carAhead.lateralOffset - car.lateralOffset) < 2.8) {
    if (ctrl.overtakeTimer <= 0) {
      const goRight = carAhead.lateralOffset < 0.2;
      ctrl.overtakeOffset = goRight ? 3.5 : -3.5;
      ctrl.overtakeTimer = 1.6 + ctrl.aggression * 0.8;
    }
    targetLane = carAhead.lateralOffset + ctrl.overtakeOffset;
  }

  targetLane = Math.max(-halfRoad, Math.min(halfRoad, targetLane));

  const aimX = farSample.pos.x + farSample.right.x * targetLane;
  const aimZ = farSample.pos.z + farSample.right.z * targetLane;

  const desiredHeading = Math.atan2(aimX - car.x, aimZ - car.z);
  const headingErr = normalizeAngle(desiredHeading - car.heading);
  const steer = Math.max(-1, Math.min(1, headingErr * 2.3));

  const sharpness = Math.abs(curveAhead.curvature) + Math.abs(farSample.curvature) * 0.6;
  let throttle = 1.0;
  let brake = 0;
  let drift = false;

  // Distinct braking & cornering commitment per specialty
  const brakeAllowance =
    ctrl.archetype === 'late-braker'
      ? 1.12
      : ctrl.archetype === 'apex-purist' || ctrl.archetype === 'alpine-climber'
        ? 1.06
        : ctrl.archetype === 'aero-demon'
          ? 0.94
          : 1.0;

  if (ctrl.driftAffinity >= 0.65 && sharpness > 0.012 && car.speed > 27 && Math.abs(steer) > 0.26) {
    drift = true;
    throttle = 0.9;
  } else {
    const safeSpeed = (sharpness > 0.019 ? 38 : sharpness > 0.0115 ? 49 : 66) * brakeAllowance;
    if (car.speed > safeSpeed) {
      throttle = ctrl.archetype === 'late-braker' ? 0.12 : 0.26;
      brake = Math.min(0.85, (car.speed - safeSpeed) / 21);
    }
  }

  // Distinct Overdrive boost deployment strategy per driver
  ctrl.boostCooldown = Math.max(0, ctrl.boostCooldown - dt);
  let boost = false;
  if (ctrl.boostCooldown <= 0 && car.boostEnergy >= ctrl.boostThreshold && sharpness < 0.0095) {
    if (ctrl.archetype === 'slipstream-hunter') {
      boost = car.slipstreamIntensity > 0.2 || ctrl.overtakeTimer > 0;
    } else if (ctrl.archetype === 'boost-sprinter') {
      boost = car.boostEnergy >= 64;
    } else if (ctrl.archetype === 'launch-rocket') {
      boost = car.speed > 18 && car.speed < 54;
    } else {
      boost = true;
    }
    if (boost && car.boostEnergy < 24) {
      ctrl.boostCooldown = 4.2;
    }
  }
  if (car.isBoosting && sharpness < 0.012 && car.boostEnergy > 14) {
    boost = true;
  }

  return { throttle, brake, steer, drift, boost };
}

function updateCheckpointsAndLaps(
  car: CarState,
  prevS: number,
  track: TrackData,
  mode: GameMode,
  totalLaps: number,
  elapsedTime: number,
  events: RaceEvent[],
): void {
  const nCheckpoints = track.checkpointCount;
  const fullMask = (1 << nCheckpoints) - 1;
  const requiredMask = fullMask & ~1;

  const sectorLen = track.totalLength / nCheckpoints;
  const prevSector = Math.floor(wrapDistance(prevS, track.totalLength) / sectorLen);
  const currSector = Math.floor(wrapDistance(car.trackS, track.totalLength) / sectorLen);

  const deltaForward = wrapDistance(car.trackS - prevS, track.totalLength);
  const movedForward = deltaForward > 0 && deltaForward < track.totalLength * 0.45;

  if (movedForward && currSector !== prevSector) {
    if (currSector > 0) {
      const bit = 1 << currSector;
      const wasSet = (car.checkpointMask & bit) !== 0;
      car.checkpointMask |= bit;
      car.lastCheckpointIndex = currSector;
      if (car.isPlayer && !wasSet) {
        events.push({
          type: 'checkpoint',
          intensity: 0.6,
          label: `SECTOR ${currSector} / ${nCheckpoints - 1}`,
        });
      }
    }

    if (prevSector === nCheckpoints - 1 && currSector === 0) {
      let passedCount = 0;
      for (let b = 1; b < nCheckpoints; b++) {
        if ((car.checkpointMask & (1 << b)) !== 0) passedCount++;
      }

      if (passedCount >= nCheckpoints - 2 && (car.checkpointMask & requiredMask) !== 0) {
        const lapDuration = elapsedTime - car.lapStartTime;
        car.lastLapTime = lapDuration;
        if (car.bestLapTime === null || lapDuration < car.bestLapTime) {
          car.bestLapTime = lapDuration;
        }
        car.lapStartTime = elapsedTime;
        car.checkpointMask = 0;

        if (mode !== 'free-roam' && car.lap >= totalLaps) {
          if (!car.finished) {
            car.finished = true;
            car.finishTime = elapsedTime;
            if (car.isPlayer) {
              events.push({
                type: 'race-finish',
                intensity: 1,
                label: 'FINISH!',
              });
            }
          }
        } else {
          car.lap += 1;
          if (car.isPlayer) {
            events.push({
              type: 'lap-complete',
              intensity: 0.9,
              label:
                mode === 'free-roam'
                  ? `LAP ${car.lap}`
                  : car.lap === totalLaps
                    ? 'FINAL LAP'
                    : `LAP ${car.lap} / ${totalLaps}`,
            });
          }
        }
      }
    }
  }

  const completedLaps = car.finished ? totalLaps : car.lap - 1;
  const normalizedS = car.finished ? 0 : car.trackS;
  car.totalProgress = completedLaps * track.totalLength + normalizedS;
}

function resolveCarCollisions(cars: CarState[], events: RaceEvent[]): void {
  const minDist = 2.65;
  const minDistSq = minDist * minDist;

  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (Math.abs(a.y - b.y) > 2.0) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dSq = dx * dx + dz * dz;

      if (dSq > 1e-6 && dSq < minDistSq) {
        const dist = Math.sqrt(dSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = (minDist - dist) * 0.52;

        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;

        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * nx + rvz * nz;

        if (velAlongNormal < 0) {
          const impulse = -velAlongNormal * 0.65;
          a.vx -= nx * impulse;
          a.vz -= nz * impulse;
          b.vx += nx * impulse;
          b.vz += nz * impulse;

          const impact = Math.min(1, Math.abs(velAlongNormal) / 22);
          if (impact > 0.14 && (a.isPlayer || b.isPlayer)) {
            a.hitFlashTimer = 0.08;
            b.hitFlashTimer = 0.08;
            events.push({ type: 'car-bump', intensity: impact });
          }
        }
      }
    }
  }
}

function updateSlipstreams(cars: CarState[], track: TrackData, dt: number): void {
  for (const car of cars) {
    let bestSlip = 0;
    if (car.speed > 26 && !car.airborne) {
      const fwd = headingToForward(car.heading);
      for (const other of cars) {
        if (other.id === car.id) continue;
        const gap = wrapDistance(other.trackS - car.trackS, track.totalLength);
        if (gap > 4 && gap < 28) {
          const latDiff = Math.abs(other.lateralOffset - car.lateralOffset);
          if (latDiff < 2.6) {
            const dx = other.x - car.x;
            const dz = other.z - car.z;
            const dist = Math.hypot(dx, dz);
            const align = (dx * fwd.x + dz * fwd.z) / Math.max(1, dist);
            if (align > 0.85) {
              const strength = (1 - (gap - 4) / 24) * (1 - latDiff / 2.6);
              if (strength > bestSlip) bestSlip = strength;
            }
          }
        }
      }
    }
    car.slipstreamIntensity += (bestSlip - car.slipstreamIntensity) * (1 - Math.exp(-5 * dt));
  }
}

export function stepRaceWorld(
  world: RaceWorldState,
  playerInput: InputState,
  track: TrackData,
  rawDt: number,
): RaceEvent[] {
  const dt = Math.max(0, Math.min(rawDt, 0.05));
  const frameEvents: RaceEvent[] = [];

  world.cameraTrauma = Math.max(0, world.cameraTrauma - 1.65 * dt);
  if (world.bannerTimer > 0) {
    world.bannerTimer = Math.max(0, world.bannerTimer - dt);
    if (world.bannerTimer === 0) {
      world.bannerText = null;
    }
  }

  // 3-2-1-GO Launch Countdown Gate
  if (world.countdownTimer > 0) {
    world.countdownTimer = Math.max(0, world.countdownTimer - dt);
    const digit = Math.ceil(world.countdownTimer);
    if (digit < world.lastCountdownDigit && digit > 0) {
      world.lastCountdownDigit = digit;
      frameEvents.push({
        type: 'countdown-tick',
        intensity: 0.65,
        label: String(digit),
      });
    }

    const targetRev = playerInput.throttle > 0.1 ? 0.45 + playerInput.throttle * 0.45 : 0.18;
    world.player.rpm += (targetRev - world.player.rpm) * (1 - Math.exp(-10 * dt));

    if (world.countdownTimer === 0 && !world.launchChecked) {
      world.launchChecked = true;
      world.lastCountdownDigit = 0;
      frameEvents.push({ type: 'countdown-tick', intensity: 1.0, label: 'GO!' });

      // Launch-rocket rivals get a snappy start reaction off the line!
      for (let i = 0; i < world.rivals.length; i++) {
        const ctrl = world.rivalControllers[i];
        if (ctrl.archetype === 'launch-rocket') {
          const r = world.rivals[i];
          const fwd = headingToForward(r.heading);
          r.vx = fwd.x * 14;
          r.vz = fwd.z * 14;
          r.speed = 14;
        }
      }

      if (playerInput.throttle > 0.5) {
        const fwd = headingToForward(world.player.heading);
        world.player.vx = fwd.x * 24;
        world.player.vz = fwd.z * 24;
        world.player.speed = 24;
        world.player.boostEnergy = Math.min(100, world.player.boostEnergy + 18);
        world.player.padBoostTimer = 0.65;
        world.cameraTrauma = Math.min(1, world.cameraTrauma + 0.25);
        world.bannerText = 'PERFECT LAUNCH!';
        world.bannerTone = 'emerald';
        world.bannerTimer = 1.8;
        frameEvents.push({
          type: 'perfect-launch',
          intensity: 1,
          label: 'PERFECT LAUNCH!',
        });
      } else {
        world.bannerText = 'GO!';
        world.bannerTone = 'emerald';
        world.bannerTimer = 1.2;
      }
    }

    world.events = frameEvents;
    return frameEvents;
  }

  if (world.hitstopTimer > 0) {
    world.hitstopTimer = Math.max(0, world.hitstopTimer - dt);
    world.events = [];
    return [];
  }

  world.elapsedTime += dt;
  const allCars = [world.player, ...world.rivals];

  updateSlipstreams(allCars, track, dt);

  // Step player car
  const prevPlayerS = world.player.trackS;
  const effectivePlayerInput: InputState = world.player.finished
    ? { throttle: 0.35, brake: 0, steer: 0, drift: false, boost: false }
    : playerInput;
  const pEvents = stepVehiclePhysics(world.player, effectivePlayerInput, track, dt, 1.0, world.tuning);
  for (const ev of pEvents) {
    frameEvents.push({
      type: ev.type,
      intensity: ev.intensity,
      points: ev.points,
      label: ev.label,
    });
    if (ev.type === 'barrier-hit') {
      world.cameraTrauma = Math.min(1, world.cameraTrauma + ev.intensity * 0.55);
      if (ev.intensity > 0.55) {
        world.hitstopTimer = 0.045;
      }
    } else if (ev.type === 'boost-ignite' || ev.type === 'boost-pad') {
      world.cameraTrauma = Math.min(1, world.cameraTrauma + 0.24);
      if (ev.type === 'boost-pad' && ev.label) {
        world.bannerText = ev.label;
        world.bannerTone = 'cyan';
        world.bannerTimer = 1.3;
      }
    } else if (ev.type === 'apex-ring' && ev.label) {
      world.bannerText = ev.label;
      world.bannerTone = 'emerald';
      world.bannerTimer = 1.3;
    } else if (ev.type === 'jump-land' && ev.label) {
      world.cameraTrauma = Math.min(1, world.cameraTrauma + 0.22);
      world.bannerText = ev.label;
      world.bannerTone = 'amber';
      world.bannerTimer = 1.4;
    }
  }
  updateCheckpointsAndLaps(
    world.player,
    prevPlayerS,
    track,
    world.mode,
    world.totalLaps,
    world.elapsedTime,
    frameEvents,
  );

  // Step all 11 AI rivals with their distinct tuning classes and physical strength profiles
  for (let i = 0; i < world.rivals.length; i++) {
    const rival = world.rivals[i];
    const ctrl = world.rivalControllers[i];
    const prevS = rival.trackS;
    const aiInput = computeRivalInput(rival, ctrl, allCars, track, dt);

    const gapToPlayer = world.player.totalProgress - rival.totalProgress;
    const rubberBand = Math.max(-0.045, Math.min(0.06, gapToPlayer / 700));
    const pace = Math.max(0.84, Math.min(1.04, ctrl.basePace + rubberBand));

    stepVehiclePhysics(rival, aiInput, track, dt, pace, ctrl.livery.tuning);
    updateCheckpointsAndLaps(
      rival,
      prevS,
      track,
      world.mode,
      world.totalLaps,
      world.elapsedTime,
      frameEvents,
    );
  }

  resolveCarCollisions(allCars, frameEvents);
  stepRoadsidePosts(world.posts, allCars, track, dt, frameEvents);
  for (const ev of frameEvents) {
    if (ev.type === 'car-bump') {
      world.cameraTrauma = Math.min(1, world.cameraTrauma + ev.intensity * 0.65);
      if (ev.intensity > 0.5) {
        world.hitstopTimer = 0.04;
      }
    } else if (ev.type === 'post-hit') {
      world.cameraTrauma = Math.min(1, world.cameraTrauma + ev.intensity * 0.16);
    }
    if (ev.label && (ev.type === 'lap-complete' || ev.type === 'race-finish')) {
      world.bannerText = ev.label;
      world.bannerTone = 'amber';
      world.bannerTimer = 2.4;
    }
  }

  world.standings = [...allCars]
    .sort((a, b) => {
      if (a.finished && b.finished) {
        return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    })
    .map((c) => c.id);

  world.events = frameEvents;
  return frameEvents;
}

export function buildStandingsTable(world: RaceWorldState): StandingsEntry[] {
  const allById = new Map<string, CarState>();
  allById.set(world.player.id, world.player);
  for (const r of world.rivals) {
    allById.set(r.id, r);
  }

  const leader = allById.get(world.standings[0]) ?? world.player;
  return world.standings.map((id, idx) => {
    const car = allById.get(id) ?? world.player;
    return {
      position: idx + 1,
      id: car.id,
      name: car.name,
      racingNumber: car.racingNumber,
      vehicleModel: car.vehicleModel,
      specialty: car.specialty,
      colorHex: car.colorHex,
      accentHex: car.accentHex,
      isPlayer: car.isPlayer,
      finished: car.finished,
      finishTime: car.finishTime,
      gapMeters: Math.max(0, Math.round(leader.totalProgress - car.totalProgress)),
    };
  });
}

export function buildRunSnapshot(
  world: RaceWorldState,
  track: TrackData,
  topSpeedKmh: number,
): RunSnapshot {
  const position = Math.max(1, world.standings.indexOf('player') + 1);
  const totalRacers = 1 + world.rivals.length;
  return {
    courseId: track.course.id,
    courseName: track.course.name,
    mode: world.mode,
    position,
    totalRacers,
    totalTime: world.player.finishTime ?? world.elapsedTime,
    bestLapTime: world.player.bestLapTime,
    totalStyleScore: Math.round(world.player.totalStyleScore + world.player.activeDriftScore),
    topSpeedKmh: Math.round(topSpeedKmh),
    isVictory: world.mode !== 'grand-prix' ? true : position <= 3,
    standingsTable: buildStandingsTable(world),
  };
}
