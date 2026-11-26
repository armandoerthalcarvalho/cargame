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
}

/**
 * Single source of truth for all static world landmark coordinates and ground footprints.
 * Shared between the Three.js environment builder and automated unit tests so no mountain,
 * mesa, dome, pagoda, or spire can ever overlap any circuit corridor.
 */
export const COURSE_LANDMARKS: Record<CourseId, CourseLandmarkSpecs> = {
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
    // Positioned majestically on the northern alpine horizon (>140m beyond nearest road edge!)
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
};

export function listCourseLandmarkFootprints(courseId: CourseId): StaticLandmarkFootprint[] {
  const spec = COURSE_LANDMARKS[courseId];
  const out: StaticLandmarkFootprint[] = [];
  if (spec.mesas) {
    for (const m of spec.mesas) {
      // Talus skirt base is radius * 1.32 with crag noise up to 1.12x
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
