import {
  createInitialCarState,
  headingToForward,
  normalizeAngle,
  stepVehiclePhysics,
} from './physics';
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
  TuningClass,
} from './types';

const RIVAL_ROSTER: Array<Omit<RivalController, 'boostCooldown' | 'overtakeOffset' | 'overtakeTimer'>> = [
  {
    id: 'rival-apex',
    name: 'V. Lindqvist',
    archetype: 'apex-purist',
    colorHex: '#2563eb',
    accentHex: '#e0f2fe',
    basePace: 0.96,
    preferredLane: -2.4,
    aggression: 0.35,
  },
  {
    id: 'rival-maverick',
    name: 'K. Takahashi',
    archetype: 'drift-maverick',
    colorHex: '#eab308',
    accentHex: '#18181b',
    basePace: 0.99,
    preferredLane: 2.5,
    aggression: 0.75,
  },
  {
    id: 'rival-hunter',
    name: 'S. Moreau',
    archetype: 'slipstream-hunter',
    colorHex: '#10b981',
    accentHex: '#ecfdf5',
    basePace: 0.94,
    preferredLane: 0.4,
    aggression: 0.62,
  },
];

export function createRaceWorld(
  track: TrackData,
  mode: GameMode,
  playerColors: { bodyColor: string; accentColor: string },
  opts?: { tuning?: TuningClass; skipCountdown?: boolean },
): RaceWorldState {
  const tuning: TuningClass = opts?.tuning ?? 'balanced';
  const startS = wrapDistance(12, track.totalLength);
  const player = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    isPlayer: true,
    colorHex: playerColors.bodyColor,
    accentHex: playerColors.accentColor,
    startS,
    lateralOffset: mode === 'grand-prix' ? -2.4 : 0,
  });

  const rivals: CarState[] = [];
  const rivalControllers: RivalController[] = [];

  if (mode === 'grand-prix') {
    const gridOffsets = [
      { ds: 10, lat: 2.4 },
      { ds: 20, lat: -2.4 },
      { ds: 30, lat: 2.4 },
    ];
    RIVAL_ROSTER.forEach((spec, idx) => {
      const slot = gridOffsets[idx];
      const car = createInitialCarState(track, {
        id: spec.id,
        name: spec.name,
        isPlayer: false,
        colorHex: spec.colorHex,
        accentHex: spec.accentHex,
        startS: wrapDistance(startS + slot.ds, track.totalLength),
        lateralOffset: slot.lat,
      });
      rivals.push(car);
      rivalControllers.push({
        ...spec,
        boostCooldown: 3 + idx * 1.5,
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
  const halfRoad = track.course.roadWidth * 0.5 - 2.2;
  const lookAheadDist =
    ctrl.archetype === 'apex-purist'
      ? Math.max(22, car.speed * 0.68)
      : ctrl.archetype === 'drift-maverick'
        ? Math.max(18, car.speed * 0.54)
        : Math.max(20, car.speed * 0.6);

  const nearSample = sampleTrackAtDistance(track, car.trackS + 14);
  const farSample = sampleTrackAtDistance(track, car.trackS + lookAheadDist);
  const curveAhead = sampleTrackAtDistance(track, car.trackS + Math.max(30, car.speed * 0.95));

  let targetLane = ctrl.preferredLane;
  if (ctrl.archetype === 'apex-purist') {
    const apexPull = Math.max(-halfRoad, Math.min(halfRoad, -farSample.curvature * 190));
    targetLane = apexPull * 0.82;
  } else if (ctrl.archetype === 'drift-maverick') {
    const wideEntry = Math.max(-halfRoad, Math.min(halfRoad, nearSample.curvature * 140));
    targetLane = wideEntry * 0.72 + Math.sin(car.trackS * 0.03) * 1.1;
  } else {
    let draftTarget: CarState | null = null;
    let bestGap = 45;
    for (const other of allCars) {
      if (other.id === car.id) continue;
      const gap = wrapDistance(other.trackS - car.trackS, track.totalLength);
      if (gap > 5 && gap < bestGap) {
        bestGap = gap;
        draftTarget = other;
      }
    }

    if (ctrl.overtakeTimer > 0) {
      ctrl.overtakeTimer = Math.max(0, ctrl.overtakeTimer - dt);
    }

    if (draftTarget) {
      if (bestGap < 15 && ctrl.overtakeTimer <= 0) {
        ctrl.overtakeOffset = draftTarget.lateralOffset >= 0 ? -3.4 : 3.4;
        ctrl.overtakeTimer = 2.4;
      }
      if (ctrl.overtakeTimer > 0) {
        targetLane = Math.max(-halfRoad, Math.min(halfRoad, draftTarget.lateralOffset + ctrl.overtakeOffset));
      } else {
        targetLane = Math.max(-halfRoad, Math.min(halfRoad, draftTarget.lateralOffset));
      }
    } else {
      targetLane = Math.max(-halfRoad, Math.min(halfRoad, -farSample.curvature * 110));
    }
  }

  targetLane = Math.max(-halfRoad, Math.min(halfRoad, targetLane));

  const aimX = farSample.pos.x + farSample.right.x * targetLane;
  const aimZ = farSample.pos.z + farSample.right.z * targetLane;

  const desiredHeading = Math.atan2(aimX - car.x, aimZ - car.z);
  const headingErr = normalizeAngle(desiredHeading - car.heading);

  const steer = Math.max(-1, Math.min(1, headingErr * 2.25));

  const sharpness = Math.abs(curveAhead.curvature) + Math.abs(farSample.curvature) * 0.6;
  let throttle = 1.0;
  let brake = 0;
  let drift = false;

  if (ctrl.archetype === 'apex-purist') {
    const safeSpeed = sharpness > 0.018 ? 38 : sharpness > 0.011 ? 49 : 65;
    if (car.speed > safeSpeed) {
      throttle = 0.2;
      brake = Math.min(0.8, (car.speed - safeSpeed) / 22);
    }
  } else if (ctrl.archetype === 'drift-maverick') {
    if (sharpness > 0.012 && car.speed > 28 && Math.abs(steer) > 0.28) {
      drift = true;
      throttle = 0.92;
    } else if (sharpness > 0.024 && car.speed > 44) {
      throttle = 0.35;
      brake = 0.45;
    }
  } else {
    const safeSpeed = sharpness > 0.019 ? 40 : sharpness > 0.012 ? 51 : 65;
    if (car.speed > safeSpeed) {
      throttle = 0.3;
      brake = Math.min(0.7, (car.speed - safeSpeed) / 20);
    }
  }

  ctrl.boostCooldown = Math.max(0, ctrl.boostCooldown - dt);
  let boost = false;
  if (ctrl.boostCooldown <= 0 && car.boostEnergy > 45 && sharpness < 0.009) {
    if (ctrl.archetype === 'drift-maverick' && car.boostEnergy > 52) {
      boost = true;
    } else if (ctrl.archetype === 'slipstream-hunter' && (car.slipstreamIntensity > 0.25 || ctrl.overtakeTimer > 0)) {
      boost = true;
    } else if (ctrl.archetype === 'apex-purist' && car.boostEnergy > 78) {
      boost = true;
    }
    if (boost && car.boostEnergy < 22) {
      ctrl.boostCooldown = 4.5;
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
      if (Math.abs(a.y - b.y) > 2.0) continue; // Airborne jump can cleanly clear another car!
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

    // Rev engine RPM on the start grid while holding throttle!
    const targetRev = playerInput.throttle > 0.1 ? 0.45 + playerInput.throttle * 0.45 : 0.18;
    world.player.rpm += (targetRev - world.player.rpm) * (1 - Math.exp(-10 * dt));

    if (world.countdownTimer === 0 && !world.launchChecked) {
      world.launchChecked = true;
      world.lastCountdownDigit = 0;
      frameEvents.push({ type: 'countdown-tick', intensity: 1.0, label: 'GO!' });

      // Perfect Launch bonus if player is holding throttle on GO!
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

  // Step AI rivals
  for (let i = 0; i < world.rivals.length; i++) {
    const rival = world.rivals[i];
    const ctrl = world.rivalControllers[i];
    const prevS = rival.trackS;
    const aiInput = computeRivalInput(rival, ctrl, allCars, track, dt);

    const gapToPlayer = world.player.totalProgress - rival.totalProgress;
    const rubberBand = Math.max(-0.06, Math.min(0.08, gapToPlayer / 520));
    const pace = Math.max(0.86, Math.min(1.06, ctrl.basePace + rubberBand));

    stepVehiclePhysics(rival, aiInput, track, dt, pace, 'balanced');
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
  for (const ev of frameEvents) {
    if (ev.type === 'car-bump') {
      world.cameraTrauma = Math.min(1, world.cameraTrauma + ev.intensity * 0.65);
      if (ev.intensity > 0.5) {
        world.hitstopTimer = 0.04;
      }
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
  };
}
