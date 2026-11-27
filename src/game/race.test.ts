import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_LIST, COURSES, LIVERY_PRESETS } from './courses';
import { buildTrack } from './track';
import {
  buildRunSnapshot,
  buildStandingsTable,
  computeRivalInput,
  createRaceWorld,
  resetCarToTrack,
  stepRaceWorld,
} from './race';
import type { InputState, RivalController } from './types';

const IDLE_INPUT: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  boost: false,
};

test('grand-prix spawns 12 distinct cars (player + 11 unique rivals) on a clean non-overlapping FIA grid', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const world = createRaceWorld(track, 'grand-prix', {
    bodyColor: '#d94826',
    accentColor: '#f6d38b',
    racingNumber: '07',
    vehicleModel: 'Solstice Ember',
  });

  assert.equal(world.rivals.length, 11);
  assert.equal(world.rivalControllers.length, 11);
  assert.equal(world.standings.length, 12);
  assert.ok(world.countdownTimer > 3.0, 'starts with 3-2-1 countdown gate');

  // Verify every single one of the 12 cars has a unique identity, number, model, specialty, and archetype
  const allCars = [world.player, ...world.rivals];
  assert.equal(new Set(allCars.map((c) => c.id)).size, 12, '12 unique car IDs');
  assert.equal(new Set(allCars.map((c) => c.name)).size, 12, '12 unique driver names');
  assert.equal(new Set(allCars.map((c) => c.racingNumber)).size, 12, '12 unique racing numbers');
  assert.equal(new Set(allCars.map((c) => c.vehicleModel)).size, 12, '12 unique vehicle models');
  assert.equal(new Set(world.rivalControllers.map((c) => c.archetype)).size, 11, '11 distinct AI archetypes');
  assert.equal(new Set(world.rivalControllers.map((c) => c.specialty)).size, 11, '11 distinct rival specialties');

  // Verify clean pairwise spacing across all 12 cars on starting grid
  for (let i = 0; i < allCars.length; i++) {
    for (let j = i + 1; j < allCars.length; j++) {
      const d = Math.hypot(allCars[i].x - allCars[j].x, allCars[i].z - allCars[j].z);
      assert.ok(d >= 6.0, `grid cars ${allCars[i].id} and ${allCars[j].id} cleanly spaced (${d.toFixed(2)}m)`);
    }
  }

  const table = buildStandingsTable(world);
  assert.equal(table.length, 12);
  assert.equal(table[0].position, 1);
  assert.equal(table[11].position, 12);
});

test('3-2-1 countdown holds all 12 cars on grid and awards Perfect Launch when holding throttle on GO', () => {
  const track = buildTrack(COURSES['sakura-skyway']);
  const world = createRaceWorld(track, 'grand-prix', {
    bodyColor: '#f3ece7',
    accentColor: '#e11d48',
  });

  const startX = world.player.x;
  const startZ = world.player.z;
  let tickCount = 0;
  let perfectLaunch = false;

  for (let i = 0; i < 200; i++) {
    const evs = stepRaceWorld(world, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
    for (const e of evs) {
      if (e.type === 'countdown-tick') tickCount++;
      if (e.type === 'perfect-launch') perfectLaunch = true;
    }
    if (world.countdownTimer > 0.1) {
      assert.ok(
        Math.hypot(world.player.x - startX, world.player.z - startZ) < 1e-4,
        'cars remain held on starting grid during countdown',
      );
    }
  }

  assert.ok(tickCount >= 4, `emitted 3, 2, 1, GO ticks (${tickCount})`);
  assert.equal(perfectLaunch, true, 'holding throttle at GO triggered Perfect Launch');
  assert.ok(world.player.speed > 20, 'Perfect Launch granted instant forward velocity');
});

test('free-roam spawns solo player with zero countdown and never forces gameover', () => {
  const track = buildTrack(COURSES['sunken-coast']);
  const world = createRaceWorld(track, 'free-roam', {
    bodyColor: '#1565a8',
    accentColor: '#e2f3ff',
  });

  assert.equal(world.rivals.length, 0);
  assert.equal(world.countdownTimer, 0);
  assert.equal(world.totalLaps, 99);
});

test('resetCarToTrack cleanly recovers a spun, off-line, airborne vehicle onto centerline', () => {
  const track = buildTrack(COURSES['glacier-observatory']);
  const world = createRaceWorld(
    track,
    'time-trial',
    { bodyColor: '#1565a8', accentColor: '#e2f3ff' },
    { skipCountdown: true },
  );

  world.player.airborne = true;
  world.player.vy = 12;
  world.player.y += 6;
  world.player.lateralOffset = 8;
  world.player.wrongWay = true;
  world.player.speed = 40;

  resetCarToTrack(world.player, track);
  assert.equal(world.player.airborne, false);
  assert.equal(world.player.vy, 0);
  assert.equal(world.player.lateralOffset, 0);
  assert.equal(world.player.wrongWay, false);
  assert.equal(world.player.speed, 0);
});

test('all 11 AI rivals autonomously navigate all 8 diverse circuits cleanly', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course);
    const world = createRaceWorld(
      track,
      'grand-prix',
      { bodyColor: '#d94826', accentColor: '#f6d38b' },
      { skipCountdown: true },
    );

    for (let i = 0; i < 16 * 60; i++) {
      stepRaceWorld(world, IDLE_INPUT, track, 1 / 60);
    }

    for (const rival of world.rivals) {
      assert.ok(
        rival.totalProgress > 480,
        `${course.id} ${rival.name} progressed ${rival.totalProgress.toFixed(0)}m`,
      );
      assert.ok(Number.isFinite(rival.x) && Number.isFinite(rival.z));
      assert.equal(rival.wrongWay, false);
    }
  }
});

test('anti-cheat checkpoint system prevents lap increment by reversing over start line', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const world = createRaceWorld(
    track,
    'time-trial',
    { bodyColor: '#d94826', accentColor: '#f6d38b' },
    { skipCountdown: true },
  );

  for (let i = 0; i < 140; i++) {
    stepRaceWorld(world, { ...IDLE_INPUT, brake: 1 }, track, 1 / 60);
  }
  for (let i = 0; i < 140; i++) {
    stepRaceWorld(world, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  }

  assert.equal(world.player.lap, 1, 'reversing and re-crossing finish line must NOT advance lap');
  assert.equal(world.player.finished, false);
});

test('driving forward through all 8 sectors completes a 2.2km lap and finishes with valid standings snapshot', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const world = createRaceWorld(
    track,
    'time-trial',
    { bodyColor: '#d94826', accentColor: '#f6d38b' },
    { skipCountdown: true },
  );
  world.totalLaps = 1;

  const dummyCtrl: RivalController = {
    id: 'player',
    name: 'You',
    racingNumber: '07',
    vehicleModel: 'Solstice Ember',
    specialty: 'Grand Tourer',
    archetype: 'apex-purist',
    livery: LIVERY_PRESETS[0],
    modifiers: {
      topSpeedMult: 1,
      accelMult: 1,
      gripMult: 1,
      driftChargeMult: 1,
      brakeMult: 1,
      boostPowerMult: 1,
    },
    colorHex: '#d94826',
    accentHex: '#f6d38b',
    basePace: 1.0,
    preferredLane: 0,
    aggression: 0.4,
    defensiveBias: 0.2,
    driftAffinity: 0.25,
    boostThreshold: 55,
    boostCooldown: 0,
    overtakeOffset: 0,
    overtakeTimer: 0,
  };

  let sawCheckpoint = false;
  let sawFinish = false;
  let maxSpeedKmh = 0;

  for (let i = 0; i < 65 * 60; i++) {
    const input = computeRivalInput(world.player, dummyCtrl, [world.player], track, 1 / 60);
    const events = stepRaceWorld(world, input, track, 1 / 60);
    maxSpeedKmh = Math.max(maxSpeedKmh, world.player.speed * 3.6);
    if (events.some((e) => e.type === 'checkpoint')) sawCheckpoint = true;
    if (events.some((e) => e.type === 'race-finish')) {
      sawFinish = true;
      break;
    }
  }

  assert.equal(sawCheckpoint, true, 'passed intermediate checkpoints');
  assert.equal(sawFinish, true, 'completed 1-lap 2.2km race and emitted race-finish');
  assert.equal(world.player.finished, true);
  assert.ok(world.player.bestLapTime !== null && world.player.bestLapTime > 20);

  const snapshot = buildRunSnapshot(world, track, maxSpeedKmh);
  assert.equal(snapshot.position, 1);
  assert.equal(snapshot.isVictory, true);
  assert.ok(snapshot.totalTime > 20);
  assert.ok(snapshot.topSpeedKmh > 160);
  assert.ok(Number.isFinite(snapshot.totalStyleScore));
  assert.equal(snapshot.standingsTable.length, 1);
});

test('car-to-car collision separates overlapping vehicles and triggers camera trauma', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const world = createRaceWorld(
    track,
    'grand-prix',
    { bodyColor: '#d94826', accentColor: '#f6d38b' },
    { skipCountdown: true },
  );

  const rival = world.rivals[0];
  rival.x = world.player.x;
  rival.z = world.player.z + 1.4;
  world.player.vx = 0;
  world.player.vz = 20;
  rival.vx = 0;
  rival.vz = 2;

  const events = stepRaceWorld(world, { ...IDLE_INPUT, throttle: 1 }, track, 1 / 60);
  const sep = Math.hypot(rival.x - world.player.x, rival.z - world.player.z);

  assert.ok(sep >= 2.2, `cars pushed apart cleanly (sep=${sep.toFixed(2)})`);
  assert.ok(events.some((e) => e.type === 'car-bump'), 'car-bump event emitted');
  assert.ok(world.cameraTrauma > 0, 'collision induced camera trauma');
});
