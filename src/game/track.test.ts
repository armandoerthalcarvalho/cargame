import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_LIST, COURSES } from './courses';
import { computeLandmarkTrackClearance, listCourseLandmarkFootprints } from './landmarks';
import {
  buildTrack,
  forwardToRight,
  groundHeightAt,
  projectToTrack,
  sampleTrackAtDistance,
} from './track';

test('all 8 diverse circuits generate closed, smooth, non-degenerate tracks spanning short sprints to long endurance', () => {
  assert.equal(COURSE_LIST.length, 8);
  let minLen = Infinity;
  let maxLen = 0;
  const difficulties = new Set<string>();
  const lengthCategories = new Set<string>();

  for (const course of COURSE_LIST) {
    const track = buildTrack(course, 480);
    minLen = Math.min(minLen, track.totalLength);
    maxLen = Math.max(maxLen, track.totalLength);
    difficulties.add(course.difficulty);
    lengthCategories.add(course.lengthCategory);

    assert.ok(
      track.totalLength >= 1150 && track.totalLength <= 3800,
      `${course.id} length ${track.totalLength.toFixed(0)}m in expected circuit range`,
    );
    assert.equal(track.samples.length, 480);
    assert.equal(track.checkpointCount, 8);
    assert.ok(track.features.length >= 5, `${course.id} has interactive track features`);

    const first = track.samples[0];
    const last = track.samples[track.samples.length - 1];
    const gap = Math.hypot(
      first.pos.x - last.pos.x,
      first.pos.y - last.pos.y,
      first.pos.z - last.pos.z,
    );
    const avgStep = track.totalLength / track.samples.length;
    assert.ok(
      gap < avgStep * 1.6,
      `${course.id} loop closes smoothly (gap=${gap.toFixed(2)}, avgStep=${avgStep.toFixed(2)})`,
    );

    for (const sample of track.samples) {
      assert.ok(
        Number.isFinite(sample.pos.x) &&
          Number.isFinite(sample.pos.y) &&
          Number.isFinite(sample.pos.z),
      );
      const tLen = Math.hypot(sample.tangent.x, sample.tangent.y, sample.tangent.z);
      assert.ok(Math.abs(tLen - 1) < 1e-4, 'tangent is unit length');
      const rLen = Math.hypot(sample.right.x, sample.right.z);
      assert.ok(Math.abs(rLen - 1) < 1e-4, 'right vector is unit length');
      const dotHoriz = sample.tangent.x * sample.right.x + sample.tangent.z * sample.right.z;
      assert.ok(Math.abs(dotHoriz) < 1e-4, 'right vector is orthogonal to tangent');
      assert.ok(Math.abs(sample.bankAngle) <= 0.14, 'bank angle stays drivable');
    }
  }

  assert.ok(minLen < 1600, `includes shorter sprint trails (shortest=${minLen.toFixed(0)}m)`);
  assert.ok(maxLen > 2800, `includes longer endurance trails (longest=${maxLen.toFixed(0)}m)`);
  assert.ok(difficulties.has('Easy'), 'includes Easy circuit');
  assert.ok(difficulties.has('Expert'), 'includes Expert circuit');
  assert.deepEqual(lengthCategories, new Set(['Short', 'Medium', 'Long']));
});

test('non-self-intersection check across all 8 circuits', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course, 240);
    const n = track.samples.length;
    const minClearance = course.roadWidth + 8;
    for (let i = 0; i < n; i++) {
      for (let j = i + 24; j < n - 24; j++) {
        const a = track.samples[i].pos;
        const b = track.samples[j].pos;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(
          d > minClearance,
          `${course.id} segments ${i} and ${j} too close (${d.toFixed(1)}m < ${minClearance}m)`,
        );
      }
    }
  }
});

test('every course places interactive features cleanly inside the asphalt width', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course);
    const types = new Set(track.features.map((f) => f.type));
    assert.ok(types.has('boost-pad'), `${course.id} has boost pads`);
    assert.ok(types.has('apex-ring'), `${course.id} has apex rings`);

    const halfRoad = course.roadWidth * 0.5;
    for (const f of track.features) {
      assert.ok(Math.abs(f.lateral) <= halfRoad - 2.0, `${f.id} fits inside asphalt`);
      assert.ok(Number.isFinite(f.pos.x) && Number.isFinite(f.pos.y) && Number.isFinite(f.pos.z));
    }
  }
});

test('projectToTrack accurately recovers arc-length and signed lateral offset on grand circuit', () => {
  const track = buildTrack(COURSES['sunstone-canyon'], 480);

  for (const testS of [40, 480, 1120, 1850]) {
    const sample = sampleTrackAtDistance(track, testS);
    for (const lat of [-5, 0, 4.5]) {
      const x = sample.pos.x + sample.right.x * lat;
      const z = sample.pos.z + sample.right.z * lat;

      const projGlobal = projectToTrack(track, x, z);
      const projHinted = projectToTrack(track, x, z, sample.index);

      assert.ok(
        Math.abs(projGlobal.lateral - lat) < 0.35,
        `global lateral error ${projGlobal.lateral} vs ${lat}`,
      );
      assert.ok(
        Math.abs(projHinted.lateral - lat) < 0.35,
        `hinted lateral error ${projHinted.lateral} vs ${lat}`,
      );

      const sDiff = Math.min(
        Math.abs(projHinted.s - sample.s),
        track.totalLength - Math.abs(projHinted.s - sample.s),
      );
      assert.ok(sDiff < 1.8, `projected s close to original (${sDiff.toFixed(2)}m)`);
    }
  }
});

test('forwardToRight obeys right-handed chase-camera orientation', () => {
  const r = forwardToRight({ x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(r.x - -1) < 1e-6);
  assert.ok(Math.abs(r.z) < 1e-6);
});

test('groundHeightAt stays finite and below asphalt/shoulder across full road width on all 8 worlds', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course, 160);
    const fullHalf = course.roadWidth * 0.5 + course.shoulderWidth;
    for (let i = 0; i < track.samples.length; i += 8) {
      const s = track.samples[i];
      for (const lat of [-fullHalf, 0, fullHalf]) {
        const x = s.pos.x + s.right.x * lat;
        const z = s.pos.z + s.right.z * lat;
        const roadY = s.pos.y + Math.sin(s.bankAngle) * lat;
        const gy = groundHeightAt(track, x, z);
        assert.ok(Number.isFinite(gy));
        assert.ok(
          gy <= roadY - 0.05,
          `${course.id} sample ${i} lat=${lat.toFixed(1)} terrain (${gy.toFixed(2)}) sits below road (${roadY.toFixed(2)})`,
        );
      }
    }
  }
});

test('no static mountain, mesa, dome, villa, pagoda, windmill, obelisk, lookout, or basalt monolith intrudes into any of the 8 circuit corridors', () => {
  for (const course of COURSE_LIST) {
    const track = buildTrack(course, 480);
    const footprints = listCourseLandmarkFootprints(course.id);
    assert.ok(footprints.length > 0, `${course.id} has static landmarks registered`);

    for (const lm of footprints) {
      const clearance = computeLandmarkTrackClearance(track, lm.x, lm.z, lm.radius);
      assert.ok(
        clearance >= 6,
        `${course.id} landmark "${lm.id}" at (${lm.x}, ${lm.z}) r=${lm.radius.toFixed(1)}m intrudes on track! clearance=${clearance.toFixed(1)}m`,
      );
    }
  }
});
