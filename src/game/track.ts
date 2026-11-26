import type {
  ControlPoint,
  CourseTheme,
  TrackFeatureInstance,
  TrackProjection,
  TrackSample,
  Vec3,
} from './types';

export interface TrackData {
  course: CourseTheme;
  samples: TrackSample[];
  totalLength: number;
  checkpointCount: number;
  checkpointDistances: number[];
  features: TrackFeatureInstance[];
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    width: number;
    depth: number;
  };
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function evaluateClosedSpline(points: ControlPoint[], u: number): Vec3 {
  const n = points.length;
  const wrapped = ((u % 1) + 1) % 1;
  const scaled = wrapped * n;
  const seg = Math.floor(scaled) % n;
  const localT = scaled - Math.floor(scaled);

  const p0 = points[(seg - 1 + n) % n];
  const p1 = points[seg];
  const p2 = points[(seg + 1) % n];
  const p3 = points[(seg + 2) % n];

  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, localT),
    y: catmullRom(p0.y, p1.y, p2.y, p3.y, localT),
    z: catmullRom(p0.z, p1.z, p2.z, p3.z, localT),
  };
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Right-handed horizontal right vector matching camera-behind view:
 * right = normalize(forward x up) = (-forward.z, 0, forward.x)
 */
export function forwardToRight(tangent: Vec3): Vec3 {
  const len = Math.hypot(tangent.x, tangent.z);
  if (len < 1e-8) return { x: -1, y: 0, z: 0 };
  return { x: -tangent.z / len, y: 0, z: tangent.x / len };
}

export function buildTrack(course: CourseTheme, sampleCount = 480): TrackData {
  const rawSteps = sampleCount * 4;
  const rawPts: Vec3[] = [];
  const cumLen: number[] = [0];

  for (let i = 0; i <= rawSteps; i++) {
    const u = i / rawSteps;
    const pt = evaluateClosedSpline(course.controlPoints, u);
    rawPts.push(pt);
    if (i > 0) {
      const prev = rawPts[i - 1];
      const d = Math.hypot(pt.x - prev.x, pt.y - prev.y, pt.z - prev.z);
      cumLen.push(cumLen[i - 1] + d);
    }
  }

  const totalLength = cumLen[rawSteps];
  const uniformPositions: Vec3[] = [];

  let cursor = 0;
  for (let i = 0; i < sampleCount; i++) {
    const targetS = (i / sampleCount) * totalLength;
    while (cursor < rawSteps - 1 && cumLen[cursor + 1] < targetS) {
      cursor++;
    }
    const segLen = Math.max(1e-6, cumLen[cursor + 1] - cumLen[cursor]);
    const alpha = (targetS - cumLen[cursor]) / segLen;
    const a = rawPts[cursor];
    const b = rawPts[cursor + 1];
    uniformPositions.push({
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
      z: a.z + (b.z - a.z) * alpha,
    });
  }

  const samples: TrackSample[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < sampleCount; i++) {
    const prev = uniformPositions[(i - 1 + sampleCount) % sampleCount];
    const curr = uniformPositions[i];
    const next = uniformPositions[(i + 1) % sampleCount];

    const tangent = normalize3({
      x: next.x - prev.x,
      y: next.y - prev.y,
      z: next.z - prev.z,
    });
    const right = forwardToRight(tangent);

    // Signed horizontal curvature (positive = curving left, negative = curving right)
    const prev2 = uniformPositions[(i - 2 + sampleCount) % sampleCount];
    const next2 = uniformPositions[(i + 2) % sampleCount];
    const tPrev = normalize3({ x: curr.x - prev2.x, y: 0, z: curr.z - prev2.z });
    const tNext = normalize3({ x: next2.x - curr.x, y: 0, z: next2.z - curr.z });
    const crossY = tPrev.z * tNext.x - tPrev.x * tNext.z;
    const segDist = (4 * totalLength) / sampleCount;
    const curvature = crossY / Math.max(1, segDist);
    const bankAngle = Math.max(-0.14, Math.min(0.14, curvature * 7.5));

    if (curr.x < minX) minX = curr.x;
    if (curr.x > maxX) maxX = curr.x;
    if (curr.z < minZ) minZ = curr.z;
    if (curr.z > maxZ) maxZ = curr.z;

    samples.push({
      index: i,
      s: (i / sampleCount) * totalLength,
      t: i / sampleCount,
      pos: curr,
      tangent,
      right,
      curvature,
      bankAngle,
    });
  }

  // Smooth bankAngle with a 7-tap pass so road never twists abruptly
  const smoothedBank = samples.map((_, i) => {
    let acc = 0;
    for (let k = -3; k <= 3; k++) {
      acc += samples[(i + k + sampleCount) % sampleCount].bankAngle;
    }
    return acc / 7;
  });
  for (let i = 0; i < sampleCount; i++) {
    samples[i].bankAngle = smoothedBank[i];
  }

  const checkpointCount = 8;
  const checkpointDistances: number[] = [];
  for (let c = 0; c < checkpointCount; c++) {
    checkpointDistances.push((c / checkpointCount) * totalLength);
  }

  const track: TrackData = {
    course,
    samples,
    totalLength,
    checkpointCount,
    checkpointDistances,
    features: [],
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      width: Math.max(1, maxX - minX),
      depth: Math.max(1, maxZ - minZ),
    },
  };

  // Instantiate interactive track features (Boost Pads, Jump Ramps, Apex Rings) along spline
  const maxFeatureLat = course.roadWidth * 0.5 - 2.6;
  track.features = (course.features ?? []).map((spec) => {
    const s = wrapDistance(spec.t * totalLength, totalLength);
    const sample = sampleTrackAtDistance(track, s);
    const clampedLat = Math.max(-maxFeatureLat, Math.min(maxFeatureLat, spec.lateral));
    const x = sample.pos.x + sample.right.x * clampedLat;
    const z = sample.pos.z + sample.right.z * clampedLat;
    const y = sample.pos.y + Math.sin(sample.bankAngle) * clampedLat;
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    return {
      id: spec.id,
      type: spec.type,
      s,
      lateral: clampedLat,
      pos: { x, y, z },
      heading,
      bankAngle: sample.bankAngle,
      radius: spec.type === 'apex-ring' ? 4.4 : spec.type === 'jump-ramp' ? 4.8 : 4.2,
    };
  });

  return track;
}

export function wrapDistance(s: number, totalLength: number): number {
  return ((s % totalLength) + totalLength) % totalLength;
}

export function sampleTrackAtDistance(track: TrackData, s: number): TrackSample {
  const n = track.samples.length;
  const wrapped = wrapDistance(s, track.totalLength);
  const fIndex = (wrapped / track.totalLength) * n;
  const i0 = Math.floor(fIndex) % n;
  const i1 = (i0 + 1) % n;
  const alpha = fIndex - Math.floor(fIndex);

  const a = track.samples[i0];
  const b = track.samples[i1];

  const tangent = normalize3({
    x: a.tangent.x + (b.tangent.x - a.tangent.x) * alpha,
    y: a.tangent.y + (b.tangent.y - a.tangent.y) * alpha,
    z: a.tangent.z + (b.tangent.z - a.tangent.z) * alpha,
  });

  return {
    index: i0,
    s: wrapped,
    t: wrapped / track.totalLength,
    pos: {
      x: a.pos.x + (b.pos.x - a.pos.x) * alpha,
      y: a.pos.y + (b.pos.y - a.pos.y) * alpha,
      z: a.pos.z + (b.pos.z - a.pos.z) * alpha,
    },
    tangent,
    right: forwardToRight(tangent),
    curvature: a.curvature + (b.curvature - a.curvature) * alpha,
    bankAngle: a.bankAngle + (b.bankAngle - a.bankAngle) * alpha,
  };
}

export function projectToTrack(
  track: TrackData,
  x: number,
  z: number,
  hintIndex?: number,
): TrackProjection {
  const samples = track.samples;
  const n = samples.length;

  let bestIdx = 0;
  let bestDistSq = Infinity;

  if (hintIndex !== undefined && hintIndex >= 0 && hintIndex < n) {
    const window = 32;
    for (let offset = -window; offset <= window; offset++) {
      const idx = (hintIndex + offset + n) % n;
      const p = samples[idx].pos;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
  }

  if (bestDistSq > 1600 || hintIndex === undefined) {
    bestDistSq = Infinity;
    for (let i = 0; i < n; i++) {
      const p = samples[i].pos;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
  }

  const curr = samples[bestIdx];
  const next = samples[(bestIdx + 1) % n];
  const prev = samples[(bestIdx - 1 + n) % n];

  const dxNext = next.pos.x - curr.pos.x;
  const dzNext = next.pos.z - curr.pos.z;
  const segLenSqNext = Math.max(1e-6, dxNext * dxNext + dzNext * dzNext);
  const projNext = ((x - curr.pos.x) * dxNext + (z - curr.pos.z) * dzNext) / segLenSqNext;

  let refinedS = curr.s;
  if (projNext >= 0) {
    const clamped = Math.min(1, projNext);
    refinedS = curr.s + clamped * (track.totalLength / n);
  } else {
    const dxPrev = curr.pos.x - prev.pos.x;
    const dzPrev = curr.pos.z - prev.pos.z;
    const segLenSqPrev = Math.max(1e-6, dxPrev * dxPrev + dzPrev * dzPrev);
    const projPrev = ((x - prev.pos.x) * dxPrev + (z - prev.pos.z) * dzPrev) / segLenSqPrev;
    const clamped = Math.max(0, Math.min(1, projPrev));
    refinedS = prev.s + clamped * (track.totalLength / n);
  }

  const sample = sampleTrackAtDistance(track, refinedS);
  const rx = x - sample.pos.x;
  const rz = z - sample.pos.z;
  const lateral = rx * sample.right.x + rz * sample.right.z;
  const roadY = sample.pos.y + Math.sin(sample.bankAngle) * lateral;

  return {
    s: sample.s,
    lateral,
    sampleIndex: bestIdx,
    sample,
    distanceSq: rx * rx + rz * rz,
    roadY,
  };
}

/**
 * Deterministic procedural ground heightfield spanning the massive 2km+ track
 * corridors and rising naturally into dramatic mesas, coastal cliffs, terraced hills, or alpine peaks.
 */
export function groundHeightAt(track: TrackData, x: number, z: number): number {
  const proj = projectToTrack(track, x, z);
  const absLat = Math.abs(proj.lateral);
  const halfRoad = track.course.roadWidth * 0.5 + track.course.shoulderWidth;

  if (absLat <= halfRoad + 6.0) {
    return proj.roadY - 0.18;
  }

  const blend = Math.min(1, (absLat - (halfRoad + 6.0)) / 30);
  const smooth = blend * blend * (3 - 2 * blend);

  // Layered natural mountain synthesis (broad geological massifs + smooth organic ridge folds, zero sawtooth spikes)
  const n1 = Math.sin(x * 0.0058 + 0.7) * Math.cos(z * 0.0052 - 0.4);
  const n2 = Math.sin(x * 0.0135 - z * 0.0118 + 1.3) * 0.48;
  const n3 = Math.cos(x * 0.029 + z * 0.026 - 0.6) * 0.22;
  const n4 = Math.sin(x * 0.062 - z * 0.054) * 0.08;

  // Smoothly folded ridges (sqrt(sin^2 + eps) avoids sharp C0 vertex spikes on terrain grid)
  const s1 = Math.sin(x * 0.0044 + z * 0.0051 + 0.4);
  const s2 = Math.cos(x * 0.0098 - z * 0.0086 + 1.1);
  const r1 = 1.0 - Math.sqrt(s1 * s1 + 0.04);
  const r2 = 1.0 - Math.sqrt(s2 * s2 + 0.05);
  const smoothRidge = r1 * 0.68 + r2 * 0.32;

  // Far-horizon sweeping mountain range elevation (starts gently beyond 95m)
  const farDist = Math.max(0, absLat - 95);
  const horizonBoost = Math.pow(Math.min(farDist / 290, 1.3), 1.32) * 76;

  let naturalY = 0;
  if (track.course.id === 'sunstone-canyon') {
    // Broad red-rock canyon walls + stepped sandstone benches + rolling talus hills
    const rawWall = Math.max(0, absLat - 28) * 0.28 + horizonBoost * 0.74;
    const rawElev = proj.roadY - 1.6 + n1 * 11 + n2 * 5.2 + n3 * 2.4 + n4 * 1.0 + rawWall * (0.58 + smoothRidge * 0.62);
    const terrace = Math.floor(rawElev / 8.5) * 8.5 + Math.min(8.5, Math.pow(((rawElev % 8.5) + 8.5) % 8.5 / 8.5, 0.64) * 8.5);
    naturalY = terrace * 0.34 + rawElev * 0.66;
  } else if (track.course.id === 'sunken-coast') {
    const isSeaSide = proj.lateral > 0;
    if (isSeaSide) {
      naturalY = -10.8 + n1 * 2.0 + n3 * 0.8;
    } else {
      const cliffRise = Math.max(0, absLat - 24) * 0.28 + horizonBoost * 0.64;
      naturalY = proj.roadY + 2.4 + cliffRise * (0.62 + smoothRidge * 0.48) + n1 * 10 + n2 * 4.8 + n3 * 2.2;
    }
  } else if (track.course.id === 'sakura-skyway') {
    // Rolling Japanese highland hills rising into stately volcanic peaks
    const ridgeRise = Math.max(0, absLat - 26) * 0.25 + horizonBoost * 0.82;
    const rawSlope = proj.roadY - 1.4 + n1 * 12 + n2 * 4.6 + n3 * 2.0 + ridgeRise * (0.54 + smoothRidge * 0.68);
    naturalY = Math.round(rawSlope / 5.0) * 5.0 * 0.16 + rawSlope * 0.84;
  } else {
    // Majestic sculpted alpine glacier massifs
    const peakRise = Math.max(0, absLat - 24) * 0.38 + horizonBoost * 0.96;
    naturalY = proj.roadY - 1.2 + n1 * 13 + n2 * 5.8 + n3 * 2.8 + n4 * 1.1 + peakRise * (0.56 + smoothRidge * 0.82);
  }

  return (proj.roadY - 0.16) * (1 - smooth) + naturalY * smooth;
}
