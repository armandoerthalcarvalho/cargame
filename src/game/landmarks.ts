import { projectToTrack } from './track';
import type { TrackData } from './track';
import type { CourseId } from './types';

export interface StaticLandmarkFootprint {
  id: string;
  x: number;
  z: number;
  radius: number;
  height?: number;
  rotY?: number;
}

export interface CourseLandmarkSpecs {
  mesas?: Array<{ id: string; x: number; z: number; radius: number; height: number }>;
  lighthouse?: { id: string; x: number; z: number; radius: number };
  villas?: Array<{ id: string; x: number; z: number; rotY: number; radius: number }>;
  pagoda?: { id: string; x: number; z: number; radius: number };
  mountain?: {
    id: string;
    x: number;
    z: number;
    baseRadius: number;
    baseHeight: number;
    spurOffsetX: number;
    spurOffsetZ: number;
    spurRadius: number;
    spurHeight: number;
    snowRadius: number;
    snowHeight: number;
  };
  domes?: Array<{ id: string; x: number; z: number; radius: number }>;
  spires?: Array<{ id: string; x: number; z: number; radius: number; height: number }>;
  windmills?: Array<{ id: string; x: number; z: number; rotY: number; radius: number; height: number }>;
  obelisks?: Array<{ id: string; x: number; z: number; rotY: number; radius: number; height: number }>;
  fireTowers?: Array<{ id: string; x: number; z: number; rotY: number; radius: number; height: number }>;
  basaltMonoliths?: Array<{ id: string; x: number; z: number; radius: number; height: number }>;
  geothermalTowers?: Array<{ id: string; x: number; z: number; rotY: number; radius: number; height: number }>;
}

/**
 * Single source of truth for all static world landmark coordinates and ground footprints.
 * Shared between the Three.js environment builder and automated unit tests so no mountain,
 * mesa, dome, pagoda, windmill, obelisk, tower, or basalt monolith can ever overlap a road corridor.
 */
export const COURSE_LANDMARKS: Record<CourseId, CourseLandmarkSpecs> = {
  'emerald-oval': {
    windmills: [
      { id: 'windmill-1', x: 138, z: 18, rotY: 0.45, radius: 11, height: 24 },
      { id: 'windmill-2', x: 382, z: 75, rotY: -0.7, radius: 11, height: 26 },
      { id: 'windmill-3', x: -102, z: 68, rotY: 0.9, radius: 11, height: 23 },
    ],
    villas: [
      { id: 'farm-1', x: 132, z: -115, rotY: 0.3, radius: 10 },
      { id: 'farm-2', x: -95, z: -145, rotY: -0.5, radius: 10 },
      { id: 'farm-3', x: 350, z: -175, rotY: 0.8, radius: 10 },
    ],
  },
  'amber-dunes': {
    obelisks: [
      { id: 'obelisk-1', x: 150, z: 22, rotY: 0.2, radius: 12, height: 42 },
      { id: 'obelisk-2', x: 458, z: 58, rotY: -0.5, radius: 14, height: 48 },
      { id: 'obelisk-3', x: -118, z: 45, rotY: 0.7, radius: 12, height: 38 },
      { id: 'obelisk-4', x: 165, z: -145, rotY: 1.1, radius: 13, height: 44 },
    ],
    mesas: [
      { id: 'dune-butte-1', x: 475, z: -260, radius: 34, height: 50 },
      { id: 'dune-butte-2', x: -165, z: 245, radius: 38, height: 56 },
    ],
  },
  'sunstone-canyon': {
    mesas: [
      { id: 'mesa-1', x: 112, z: 86, radius: 32, height: 52 },
      { id: 'mesa-2', x: -128, z: 135, radius: 36, height: 62 },
      { id: 'mesa-3', x: 270, z: 230, radius: 44, height: 72 },
      { id: 'mesa-4', x: 525, z: -55, radius: 40, height: 64 },
      { id: 'mesa-5', x: 205, z: -495, radius: 38, height: 58 },
      { id: 'mesa-6', x: -105, z: -165, radius: 30, height: 46 },
    ],
  },
  'sunken-coast': {
    lighthouse: { id: 'coast-lighthouse', x: -86, z: 210, radius: 13 },
    villas: [
      { id: 'villa-1', x: 64, z: -120, rotY: 0.2, radius: 11 },
      { id: 'villa-2', x: 74, z: 35, rotY: -0.4, radius: 11 },
      { id: 'villa-3', x: 84, z: 170, rotY: 0.5, radius: 11 },
      { id: 'villa-4', x: -55, z: -245, rotY: 1.1, radius: 11 },
      { id: 'villa-5', x: -210, z: -280, rotY: -0.6, radius: 11 },
      { id: 'villa-6', x: -235, z: 225, rotY: 0.9, radius: 11 },
    ],
  },
  'sakura-skyway': {
    pagoda: { id: 'sakura-pagoda', x: 118, z: 148, radius: 11 },
    mountain: {
      id: 'mount-solstice',
      x: 230,
      z: 730,
      baseRadius: 210,
      baseHeight: 178,
      spurOffsetX: -110,
      spurOffsetZ: 35,
      spurRadius: 122,
      spurHeight: 116,
      snowRadius: 82,
      snowHeight: 68,
    },
  },
  'glacier-observatory': {
    domes: [
      { id: 'dome-1', x: 96, z: 190, radius: 18 },
      { id: 'dome-2', x: 200, z: 120, radius: 16 },
      { id: 'dome-3', x: -72, z: 92, radius: 13 },
      { id: 'dome-4', x: 205, z: -175, radius: 15 },
    ],
    spires: [
      { id: 'spire-1', x: -72, z: -95, radius: 11, height: 36 },
      { id: 'spire-2', x: 102, z: 58, radius: 13, height: 44 },
      { id: 'spire-3', x: 168, z: 245, radius: 15, height: 50 },
      { id: 'spire-4', x: 360, z: 95, radius: 16, height: 54 },
      { id: 'spire-5', x: 118, z: -285, radius: 13, height: 40 },
      { id: 'spire-6', x: -95, z: 220, radius: 12, height: 38 },
    ],
  },
  'redwood-switchbacks': {
    fireTowers: [
      { id: 'lookout-1', x: 210, z: 145, rotY: 0.3, radius: 10, height: 28 },
      { id: 'lookout-2', x: 305, z: -145, rotY: -0.6, radius: 10, height: 30 },
      { id: 'lookout-3', x: -112, z: 115, rotY: 0.9, radius: 10, height: 26 },
      { id: 'lookout-4', x: 660, z: 60, rotY: 1.4, radius: 10, height: 32 },
    ],
    mountain: {
      id: 'mount-sequoia',
      x: 295,
      z: 775,
      baseRadius: 205,
      baseHeight: 168,
      spurOffsetX: 125,
      spurOffsetZ: -20,
      spurRadius: 118,
      spurHeight: 110,
      snowRadius: 72,
      snowHeight: 54,
    },
  },
  'obsidian-caldera': {
    basaltMonoliths: [
      { id: 'basalt-1', x: 215, z: 155, radius: 22, height: 58 },
      { id: 'basalt-2', x: 355, z: -155, radius: 24, height: 64 },
      { id: 'basalt-3', x: -135, z: 65, radius: 22, height: 52 },
      { id: 'basalt-4', x: 755, z: 115, radius: 26, height: 68 },
      { id: 'basalt-5', x: 340, z: 640, radius: 28, height: 74 },
      { id: 'basalt-6', x: 335, z: -610, radius: 25, height: 62 },
    ],
    geothermalTowers: [
      { id: 'geo-1', x: 180, z: -130, rotY: 0.4, radius: 14, height: 26 },
      { id: 'geo-2', x: 385, z: 255, rotY: -0.7, radius: 14, height: 28 },
      { id: 'geo-3', x: 465, z: -265, rotY: 0.9, radius: 14, height: 26 },
    ],
  },
};

export function listCourseLandmarkFootprints(courseId: CourseId): StaticLandmarkFootprint[] {
  const spec = COURSE_LANDMARKS[courseId];
  const out: StaticLandmarkFootprint[] = [];
  if (spec.mesas) {
    for (const m of spec.mesas) {
      out.push({ id: m.id, x: m.x, z: m.z, radius: m.radius * 1.45, height: m.height });
    }
  }
  if (spec.lighthouse) {
    out.push(spec.lighthouse);
  }
  if (spec.villas) {
    for (const v of spec.villas) {
      out.push({ id: v.id, x: v.x, z: v.z, radius: v.radius, rotY: v.rotY });
    }
  }
  if (spec.pagoda) {
    out.push(spec.pagoda);
  }
  if (spec.mountain) {
    const mt = spec.mountain;
    out.push({ id: mt.id, x: mt.x, z: mt.z, radius: mt.baseRadius, height: mt.baseHeight });
    out.push({
      id: `${mt.id}-spur`,
      x: mt.x + mt.spurOffsetX,
      z: mt.z + mt.spurOffsetZ,
      radius: mt.spurRadius,
      height: mt.spurHeight,
    });
  }
  if (spec.domes) {
    for (const d of spec.domes) {
      out.push({ id: d.id, x: d.x, z: d.z, radius: d.radius * 1.25 });
    }
  }
  if (spec.spires) {
    for (const s of spec.spires) {
      out.push({ id: s.id, x: s.x, z: s.z, radius: s.radius * 1.5, height: s.height });
    }
  }
  if (spec.windmills) {
    for (const w of spec.windmills) {
      out.push({ id: w.id, x: w.x, z: w.z, radius: w.radius * 1.2, height: w.height, rotY: w.rotY });
    }
  }
  if (spec.obelisks) {
    for (const o of spec.obelisks) {
      out.push({ id: o.id, x: o.x, z: o.z, radius: o.radius * 1.35, height: o.height, rotY: o.rotY });
    }
  }
  if (spec.fireTowers) {
    for (const f of spec.fireTowers) {
      out.push({ id: f.id, x: f.x, z: f.z, radius: f.radius * 1.25, height: f.height, rotY: f.rotY });
    }
  }
  if (spec.basaltMonoliths) {
    for (const b of spec.basaltMonoliths) {
      out.push({ id: b.id, x: b.x, z: b.z, radius: b.radius * 1.4, height: b.height });
    }
  }
  if (spec.geothermalTowers) {
    for (const g of spec.geothermalTowers) {
      out.push({ id: g.id, x: g.x, z: g.z, radius: g.radius * 1.25, height: g.height, rotY: g.rotY });
    }
  }
  return out;
}

/**
 * Returns the signed clearance in meters between a circular landmark footprint and the
 * outer edge of the track's shoulder corridor. Positive = completely clear of track.
 */
export function computeLandmarkTrackClearance(
  track: TrackData,
  x: number,
  z: number,
  footprintRadius: number,
): number {
  const proj = projectToTrack(track, x, z);
  const distToCenterline = Math.sqrt(proj.distanceSq);
  const corridorHalf = track.course.roadWidth * 0.5 + track.course.shoulderWidth;
  return distToCenterline - corridorHalf - footprintRadius;
}
