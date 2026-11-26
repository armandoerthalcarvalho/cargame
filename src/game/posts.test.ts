import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_LIST, COURSES } from './courses';
import { createInitialCarState, headingToForward } from './physics';
import { createRoadsidePosts, stepRoadsidePosts } from './posts';
import { buildTrack, projectToTrack } from './track';
import type { RaceEvent } from './types';

test('all four courses spawn collapsible roadside delineator bollards cleanly inside guardrail reach', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course);
    const posts = createRoadsidePosts(track);
    assert.ok(posts.length >= 100, `${course.id} spawns at least 100 delineator posts (${posts.length})`);

    const halfAsphalt = course.roadWidth * 0.5;
    const guardrailLimit = halfAsphalt + course.shoulderWidth - 1.25;

    for (const p of posts) {
      const proj = projectToTrack(track, p.x, p.z);
      const absLat = Math.abs(proj.lateral);
      assert.ok(
        absLat > halfAsphalt + 1.0 && absLat < guardrailLimit + 0.95,
        `${course.id} post ${p.id} sits on shoulder apron (lat=${absLat.toFixed(2)}, asphalt=${halfAsphalt}, barrier=${guardrailLimit})`,
      );
      assert.equal(p.knocked, false);
      assert.equal(p.settled, false);
    }
  }
});

test('driving into a roadside post triggers collision, 3D launch velocity, tumble spin, bounce, and ground settle', () => {
  const track = buildTrack(COURSES['sunstone-canyon']);
  const posts = createRoadsidePosts(track);
  const target = posts[0];

  const car = createInitialCarState(track, {
    id: 'player',
    name: 'You',
    isPlayer: true,
    colorHex: '#d94826',
    accentHex: '#f6d38b',
    startS: 50,
    lateralOffset: 0,
  });

  // Position car driving straight through the first delineator post at ~36 m/s (130 km/h)
  const fwd = headingToForward(target.baseYaw);
  car.heading = target.baseYaw;
  car.x = target.baseX - fwd.x * 1.1;
  car.y = target.baseY;
  car.z = target.baseZ - fwd.z * 1.1;
  car.vx = fwd.x * 36;
  car.vz = fwd.z * 36;
  car.speed = 36;

  const speedBefore = Math.hypot(car.vx, car.vz);
  const events: RaceEvent[] = [];

  stepRoadsidePosts(posts, [car], track, 1 / 60, events);

  assert.equal(target.knocked, true, 'post is marked knocked on impact');
  assert.ok(
    events.some((e) => e.type === 'post-hit'),
    'post-hit event emitted for player collision',
  );
  assert.ok(target.vy > 4, `post launched upward (vy=${target.vy.toFixed(2)})`);
  assert.ok(Math.hypot(target.vx, target.vz) > 20, 'post inherited forward momentum from car');
  assert.ok(Math.abs(target.vrx) > 5, 'post received 3D tumbling angular velocity');
  assert.ok(Math.hypot(car.vx, car.vz) < speedBefore, 'car experienced realistic subtle momentum bleed');

  // Move car away and simulate 4 seconds of ballistic arc, gravity, bounce, and ground settling
  car.x += 500;
  let maxHeightAboveBase = 0;
  for (let step = 0; step < 240; step++) {
    stepRoadsidePosts(posts, [car], track, 1 / 60, []);
    maxHeightAboveBase = Math.max(maxHeightAboveBase, target.y - target.baseY);
  }

  assert.ok(maxHeightAboveBase > 0.6, `post flew visibly airborne (maxH=${maxHeightAboveBase.toFixed(2)}m)`);
  assert.ok(
    Math.hypot(target.x - target.baseX, target.z - target.baseZ) > 5,
    'post traveled significantly downrange from its base',
  );
  assert.equal(target.settled, true, 'post bounced and settled cleanly on the ground');
  assert.equal(target.vx, 0);
  assert.equal(target.vy, 0);
  assert.equal(target.vz, 0);
  assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z));
});
