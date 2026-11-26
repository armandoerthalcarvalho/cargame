import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSES } from './courses';
import { buildTrack } from './track';
import {
  computeGearAndRpm,
  createInitialCarState,
  headingToForward,
  headingToRight,
  PHYSICS_CONSTANTS,
  stepVehiclePhysics,
} from './physics';
import type { InputState } from './types';

const IDLE_INPUT: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  boost: false,
};

test('car survives 5 seconds at spawn with zero input without crashing, drifting, or NaN', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const car = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    isPlayer: true,
    colorHex: '#d94826',
    accentHex: '#f6d38b',
    startS: 12,
    lateralOffset: 0,
  });

  const startX = car.x;
  const startZ = car.z;

  for (let i = 0; i < 300; i++) {
    const events = stepVehiclePhysics(car, IDLE_INPUT, track, 1 / 60);
    assert.equal(events.length, 0);
  }

  assert.equal(car.speed, 0);
  assert.ok(Math.hypot(car.x - startX, car.z - startZ) < 1e-4);
  assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.z));
  assert.equal(car.wrongWay, false);
});

test('throttle accelerates smoothly, braking slows and reverses, dt clamping prevents instability', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const car = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    isPlayer: true,
    colorHex: '#d94826',
    accentHex: '#f6d38b',
    startS: 12,
    lateralOffset: 0,
  });

  for (let i = 0; i < 180; i++) {
    stepVehiclePhysics(car, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  }
  assert.ok(car.speed > 40 && car.speed <= PHYSICS_CONSTANTS.boostMaxSpeed + 8, `speed=${car.speed}`);
  assert.ok(car.gear >= 3);

  const beforeX = car.x;
  const beforeZ = car.z;
  stepVehiclePhysics(car, { ...IDLE_INPUT, throttle: 1 }, track, 5.0);
  const jumpDist = Math.hypot(car.x - beforeX, car.z - beforeZ);
  assert.ok(jumpDist < (PHYSICS_CONSTANTS.boostMaxSpeed + 10) * PHYSICS_CONSTANTS.maxDt + 1);
  assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z));

  for (let i = 0; i < 200; i++) {
    stepVehiclePhysics(car, { ...IDLE_INPUT, brake: 1 }, track, 1 / 60);
  }
  assert.ok(car.speed < -2 && car.speed >= PHYSICS_CONSTANTS.maxReverseSpeed);
  assert.equal(car.gear, 0);
});

test('steering left turns toward chase-camera left and right turns toward right', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const carLeft = createInitialCarState(track, {
    id: 'p1',
    name: 'L',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: 12,
    lateralOffset: 0,
  });
  const carRight = { ...carLeft, id: 'p2', featureCooldowns: {} };

  for (let i = 0; i < 60; i++) {
    stepVehiclePhysics(carLeft, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
    stepVehiclePhysics(carRight, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  }
  const h0 = carLeft.heading;

  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(carLeft, { ...IDLE_INPUT, throttle: 1, steer: 1 }, track, 1 / 60);
    stepVehiclePhysics(carRight, { ...IDLE_INPUT, throttle: 1, steer: -1 }, track, 1 / 60);
  }

  assert.ok(carLeft.heading > h0 + 0.15, 'steering left (+1) increases heading');
  assert.ok(carRight.heading < h0 - 0.15, 'steering right (-1) decreases heading');

  const f = headingToForward(carLeft.heading);
  const r = headingToRight(carLeft.heading);
  assert.ok(Math.abs(f.x * r.x + f.z * r.z) < 1e-6);
});

test('drifting accumulates score, charges boost energy, and banks style score on exit', () => {
  const wideCourse = {
    ...COURSES['sunstone-canyon'],
    roadWidth: 42,
    shoulderWidth: 8,
    features: [],
  };
  const track = buildTrack(wideCourse);
  const car = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: 15,
    lateralOffset: 0,
  });
  car.boostEnergy = 20;

  for (let i = 0; i < 80; i++) {
    stepVehiclePhysics(car, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  }
  const boostBeforeDrift = car.boostEnergy;

  for (let i = 0; i < 48; i++) {
    stepVehiclePhysics(car, { ...IDLE_INPUT, throttle: 1, steer: 0.55, drift: true }, track, 1 / 60);
  }
  assert.equal(car.isDrifting, true);
  assert.ok(car.activeDriftScore > 30, `activeDriftScore=${car.activeDriftScore}`);
  assert.ok(car.boostEnergy > boostBeforeDrift + 4, 'drift charges boost gauge');

  const events = stepVehiclePhysics(
    car,
    { ...IDLE_INPUT, throttle: 1, steer: 0, drift: false },
    track,
    1 / 60,
  );
  assert.equal(car.isDrifting, false);
  assert.ok(car.totalStyleScore > 30, 'drift score banked into totalStyleScore');
  assert.ok(events.some((e) => e.type === 'drift-bank'));
});

test('boost increases top speed above normal limit and consumes energy; aero tuning exceeds balanced', () => {
  const longStraightCourse = {
    ...COURSES['sunken-coast'],
    roadWidth: 32,
    features: [],
    controlPoints: [
      { x: 0, y: 0, z: -300 },
      { x: 0, y: 0, z: -150 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 150 },
      { x: 0, y: 0, z: 300 },
      { x: 180, y: 0, z: 300 },
      { x: 180, y: 0, z: 0 },
      { x: 180, y: 0, z: -300 },
    ],
  };
  const track = buildTrack(longStraightCourse);
  const carBal = createInitialCarState(track, {
    id: 'bal',
    name: 'Bal',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: 160,
    lateralOffset: 0,
  });
  const carAero = createInitialCarState(track, {
    id: 'aero',
    name: 'Aero',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: 160,
    lateralOffset: 0,
  });
  carBal.boostEnergy = 100;
  carAero.boostEnergy = 100;

  for (let i = 0; i < 240; i++) {
    stepVehiclePhysics(carBal, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60, 1, 'balanced');
    stepVehiclePhysics(carAero, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60, 1, 'aero');
  }
  const normalSpeed = carBal.speed;
  assert.ok(carAero.speed > carBal.speed + 1.5, `aero (${carAero.speed.toFixed(1)}) > balanced (${carBal.speed.toFixed(1)})`);

  let ignited = false;
  for (let i = 0; i < 75; i++) {
    const evs = stepVehiclePhysics(carBal, { ...IDLE_INPUT, throttle: 1, boost: true }, track, 1 / 60);
    if (evs.some((e) => e.type === 'boost-ignite')) ignited = true;
  }

  assert.equal(ignited, true);
  assert.ok(carBal.speed > normalSpeed + 6, `boost speed ${carBal.speed.toFixed(1)} exceeds normal ${normalSpeed.toFixed(1)}`);
  assert.ok(carBal.boostEnergy < 75, 'boost energy consumed');
});

test('interactive boost pad, jump ramp 3D airborne arc, and apex ring combo work cleanly', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const pad = track.features.find((f) => f.type === 'boost-pad')!;
  const ramp = track.features.find((f) => f.type === 'jump-ramp')!;
  const ring = track.features.find((f) => f.type === 'apex-ring')!;

  // 1. Boost Pad triggers speed surge, boost refill, style points, and cooldown
  const car1 = createInitialCarState(track, {
    id: 'c1',
    name: 'P1',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: pad.s,
    lateralOffset: pad.lateral,
  });
  car1.boostEnergy = 30;
  const padEvs = stepVehiclePhysics(car1, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  assert.ok(padEvs.some((e) => e.type === 'boost-pad'), 'boost pad event emitted');
  assert.ok(car1.speed >= 50, `boost pad surged speed to ${car1.speed.toFixed(1)}`);
  assert.ok(car1.boostEnergy > 50, 'boost pad refilled energy');
  assert.ok(car1.totalStyleScore >= 100);
  assert.ok(car1.featureCooldowns[pad.id] > 0, 'boost pad enters cooldown to avoid double-trigger');

  // 2. Jump Ramp launches car airborne, climbs above road, falls under gravity, and lands cleanly with airtime bonus
  const car2 = createInitialCarState(track, {
    id: 'c2',
    name: 'P2',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: ramp.s,
    lateralOffset: ramp.lateral,
  });
  const fwd = headingToForward(car2.heading);
  car2.vx = fwd.x * 46;
  car2.vz = fwd.z * 46;
  car2.speed = 46;

  let launched = false;
  let maxAltitude = 0;
  let landed = false;

  for (let i = 0; i < 150; i++) {
    const evs = stepVehiclePhysics(car2, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
    if (evs.some((e) => e.type === 'jump-launch')) launched = true;
    if (evs.some((e) => e.type === 'jump-land')) landed = true;
    maxAltitude = Math.max(maxAltitude, car2.y - car2.groundY);
  }
  assert.equal(launched, true, 'jump ramp launched car');
  assert.ok(maxAltitude > 2.2, `car achieved real 3D airborne height (${maxAltitude.toFixed(2)}m)`);
  assert.equal(landed, true, 'car landed cleanly and emitted jump-land');
  assert.equal(car2.airborne, false, 'car returned safely to ground');
  assert.ok(car2.totalStyleScore > 0, 'airtime awarded style score');

  // 3. Apex Ring increments combo multiplier & awards multiplied score
  const car3 = createInitialCarState(track, {
    id: 'c3',
    name: 'P3',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: ring.s,
    lateralOffset: ring.lateral,
  });
  const ringEvs = stepVehiclePhysics(car3, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  assert.ok(ringEvs.some((e) => e.type === 'apex-ring'));
  assert.equal(car3.comboMultiplier, 2, 'apex ring bumped combo multiplier to x2');
  assert.equal(car3.totalStyleScore, 300, 'apex ring awarded 150 * 2 = 300 pts');
});

test('guardrail containment prevents escaping track corridor under extreme steering', () => {
  const track = buildTrack(COURSES['glacier-observatory']);
  const car = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    isPlayer: true,
    colorHex: '#fff',
    accentHex: '#000',
    startS: 20,
    lateralOffset: 0,
  });
  const maxAllowedLat = track.course.roadWidth * 0.5 + track.course.shoulderWidth;
  let hitBarrier = false;

  for (let i = 0; i < 300; i++) {
    const evs = stepVehiclePhysics(
      car,
      { ...IDLE_INPUT, throttle: 1, steer: -1, boost: i % 40 < 20 },
      track,
      1 / 60,
    );
    if (evs.some((e) => e.type === 'barrier-hit')) hitBarrier = true;
    assert.ok(
      Math.abs(car.lateralOffset) <= maxAllowedLat + 0.05,
      `car stayed inside corridor: lat=${car.lateralOffset}, limit=${maxAllowedLat}`,
    );
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.z));
  }
  assert.equal(hitBarrier, true, 'extreme steering hit guardrail and emitted barrier-hit event');
});

test('computeGearAndRpm maps reverse and gears 1 through 6 monotonically', () => {
  assert.equal(computeGearAndRpm(-5).gear, 0);
  assert.equal(computeGearAndRpm(0).gear, 1);
  assert.equal(computeGearAndRpm(18).gear, 2);
  assert.equal(computeGearAndRpm(30).gear, 3);
  assert.equal(computeGearAndRpm(42).gear, 4);
  assert.equal(computeGearAndRpm(55).gear, 5);
  assert.equal(computeGearAndRpm(74).gear, 6);
});
