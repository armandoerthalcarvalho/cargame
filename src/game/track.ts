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

  if (absLat <= halfRoad + 2.0) {
    return proj.roadY - 0.16;
  }

  const blend = Math.min(1, (absLat - (halfRoad + 2.0)) / 28);
  const smooth = blend * blend * (3 - 2 * blend);

  const waveA = Math.sin(x * 0.011 + 0.7) * Math.cos(z * 0.01 - 0.4);
  const waveB = Math.sin(x * 0.029 - z * 0.025) * 0.5;
  const ridge = Math.abs(Math.sin(x * 0.007 + z * 0.0085));

  let naturalY = 0;
  if (track.course.id === 'sunstone-canyon') {
    const mesa = Math.max(0, absLat - 30) * 0.36;
    naturalY = proj.roadY - 2.0 + waveA * 10 + waveB * 4.5 + mesa * (0.6 + ridge * 0.85);
  } else if (track.course.id === 'sunken-coast') {
    const isSeaSide = proj.lateral > 0;
    if (isSeaSide) {
      naturalY = -10.5 + waveA * 2.2;
    } else {
      naturalY = proj.roadY + 3.5 + Math.max(0, absLat - 26) * 0.28 + waveA * 9 + waveB * 4;
    }
  } else if (track.course.id === 'sakura-skyway') {
    // Terraced Japanese mountain slopes with gentle stepped contour shelves
    const rawSlope = proj.roadY - 1.5 + waveA * 11 + waveB * 3.5 + Math.max(0, absLat - 28) * 0.26 * (0.55 + ridge * 0.7);
    naturalY = Math.round(rawSlope / 3.2) * 3.2 * 0.35 + rawSlope * 0.65;
  } else {
    const peak = Math.max(0, absLat - 24) * 0.48;
    naturalY = proj.roadY - 1.2 + waveA * 12 + waveB * 5 + peak * (0.7 + ridge * 0.9);
  }

  return (proj.roadY - 0.16) * (1 - smooth) + naturalY * smooth;
}
