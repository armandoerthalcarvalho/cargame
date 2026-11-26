import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_LIST, COURSES } from './courses';
import { buildTrack } from './track';
import {
  buildRunSnapshot,
  computeRivalInput,
  createRaceWorld,
  resetCarToTrack,
  stepRaceWorld,
} from './race';
import type { InputState } from './types';

const IDLE_INPUT: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  boost: false,
};

test('grand-prix spawns 1 player, 3 distinct AI archetypes, and 3-2-1 start countdown', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const world = createRaceWorld(track, 'grand-prix', {
    bodyColor: '#d94826',
    accentColor: '#f6d38b',
  });

  assert.equal(world.rivals.length, 3);
  const archetypes = new Set(world.rivalControllers.map((c) => c.archetype));
  assert.deepEqual(archetypes, new Set(['apex-purist', 'drift-maverick', 'slipstream-hunter']));
  assert.equal(world.standings.length, 4);
  assert.ok(world.countdownTimer > 3.0, 'starts with 3-2-1 countdown gate');
});

test('3-2-1 countdown holds cars on grid and awards Perfect Launch when holding throttle on GO', () => {
  const track = buildTrack(COURSES['sakura-skyway']);
  const world = createRaceWorld(track, 'grand-prix', {
    bodyColor: '#f3ece7',
    accentColor: '#e11d48',
  });

  const startX = world.player.x;
  const startZ = world.player.z;
  let tickCount = 0;
  let perfectLaunch = false;

  // Step through the 3.15s countdown holding throttle
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

test('all 3 AI archetypes autonomously navigate all 4 massive circuits cleanly', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course);
    const world = createRaceWorld(
      track,
      'grand-prix',
      { bodyColor: '#d94826', accentColor: '#f6d38b' },
      { skipCountdown: true },
    );

    for (let i = 0; i < 20 * 60; i++) {
      stepRaceWorld(world, IDLE_INPUT, track, 1 / 60);
    }

    for (const rival of world.rivals) {
      assert.ok(
        rival.totalProgress > 650,
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

test('driving forward through all 8 sectors completes a 2.2km lap and finishes with valid snapshot', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const world = createRaceWorld(
    track,
    'time-trial',
    { bodyColor: '#d94826', accentColor: '#f6d38b' },
    { skipCountdown: true },
  );
  world.totalLaps = 1;

  const dummyCtrl = {
    id: 'player',
    name: 'You',
    archetype: 'apex-purist' as const,
    colorHex: '#d94826',
    accentHex: '#f6d38b',
    basePace: 1.0,
    preferredLane: 0,
    aggression: 0.4,
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
