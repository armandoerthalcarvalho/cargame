import { headingToForward } from './physics';
import { groundHeightAt } from './track';
import type { TrackData } from './track';
import type { CarState, RaceEvent, RoadsidePostState } from './types';

export const POST_PHYSICS = {
  gravity: 24,
  postRadius: 0.14,
  carHullRadius: 1.18,
  carHullHalfLength: 1.38,
  restitution: 0.34,
  groundFriction: 0.58,
  airDrag: 0.65,
  sleepVelSq: 0.18,
  minGroundCenterY: 0.12,
};

/**
 * Spawns collapsible motorsport flexible delineator bollards cleanly along both sides of the
 * outer curb / inner shoulder apron (strictly inside the Armco steel guardrail boundary so
 * vehicles can physically clip and send them tumbling with full 3D rigid-body physics).
 */
export function createRoadsidePosts(track: TrackData): RoadsidePostState[] {
  const posts: RoadsidePostState[] = [];
  const halfRoad = track.course.roadWidth * 0.5;
  // Positioned right outside the painted curb (curb ends at halfRoad + 1.15m),
  // safely inside the car's guardrail reach (halfRoad + shoulderWidth - 1.25m)
  const bollardLat = halfRoad + 1.48;
  const step = 6;
  let nextId = 0;

  for (let i = 0; i < track.samples.length; i += step) {
    const s = track.samples[i];
    // Keep start grid / pit plaza apron clean and uncluttered
    if (s.s < 45 || s.s > track.totalLength - 28) continue;

    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      const lat = side * bollardLat;
      const bx = s.pos.x + s.right.x * lat;
      const bz = s.pos.z + s.right.z * lat;
      const by = s.pos.y + Math.sin(s.bankAngle) * lat;

      posts.push({
        id: nextId++,
        baseX: bx,
        baseY: by,
        baseZ: bz,
        baseYaw: yaw,
        x: bx,
        y: by,
        z: bz,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: yaw,
        rz: 0,
        vrx: 0,
        vry: 0,
        vrz: 0,
        knocked: false,
        settled: false,
        hitCooldown: 0,
      });
    }
  }

  return posts;
}

/**
 * Steps 3D rigid-body collision & ballistic tumble physics for every roadside delineator post.
 * Uses a dual-circle car hull (front nose + rear quarter) so bumper clips and wide drift sweeps
 * both trigger authentic knock-down launches.
 */
export function stepRoadsidePosts(
  posts: RoadsidePostState[],
  cars: CarState[],
  track: TrackData,
  rawDt: number,
  events: RaceEvent[],
): void {
  const dt = Math.max(0, Math.min(rawDt, 0.05));
  if (dt <= 0 || posts.length === 0) return;

  const hitThreshold = POST_PHYSICS.carHullRadius + POST_PHYSICS.postRadius;
  const hitThresholdSq = hitThreshold * hitThreshold;
  const broadphaseSq = (POST_PHYSICS.carHullHalfLength + hitThreshold + 0.8) ** 2;

  // Precompute front & rear collision hull centers per car once per frame
  const carHulls = cars.map((car) => {
    const fwd = headingToForward(car.heading);
    return {
      car,
      fx: car.x + fwd.x * POST_PHYSICS.carHullHalfLength,
      fz: car.z + fwd.z * POST_PHYSICS.carHullHalfLength,
      rx: car.x - fwd.x * POST_PHYSICS.carHullHalfLength,
      rz: car.z - fwd.z * POST_PHYSICS.carHullHalfLength,
    };
  });

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (post.hitCooldown > 0) {
      post.hitCooldown = Math.max(0, post.hitCooldown - dt);
    }

    // 1. Check collision against every car (front & rear hull spheres)
    if (post.hitCooldown <= 0) {
      for (let c = 0; c < carHulls.length; c++) {
        const hull = carHulls[c];
        const car = hull.car;
        // Skip if car is flying high overhead off a ramp
        if (car.y > post.y + 1.75) continue;

        const cdx = post.x - car.x;
        const cdz = post.z - car.z;
        if (cdx * cdx + cdz * cdz > broadphaseSq) continue;

        // Check both front and rear hull circles
        let hitDx = post.x - hull.fx;
        let hitDz = post.z - hull.fz;
        let dSq = hitDx * hitDx + hitDz * hitDz;
        if (dSq > hitThresholdSq) {
          hitDx = post.x - hull.rx;
          hitDz = post.z - hull.rz;
          dSq = hitDx * hitDx + hitDz * hitDz;
        }
        if (dSq > hitThresholdSq) continue;

        const dist = Math.max(0.05, Math.sqrt(dSq));
        const nx = hitDx / dist;
        const nz = hitDz / dist;
        const carSpeed = Math.hypot(car.vx, car.vz);
        const launchSpeed = Math.max(7.5, carSpeed * 1.18);

        // Push post clear of car bumper and apply directional 3D impulse + upward loft
        post.x += nx * (hitThreshold - dist + 0.25);
        post.z += nz * (hitThreshold - dist + 0.25);
        post.vx = car.vx * 1.12 + nx * (4.8 + carSpeed * 0.22);
        post.vz = car.vz * 1.12 + nz * (4.8 + carSpeed * 0.22);
        post.vy = Math.min(13.5, 4.2 + launchSpeed * 0.14);

        // Realistic 3D tumbling spin proportional to impact speed & lateral offset
        const spinMag = Math.min(18, 6.5 + launchSpeed * 0.24);
        const sideSign = ((post.id % 2 === 0 ? 1 : -1) * (nx >= 0 ? 1 : -1)) || 1;
        post.vrx = spinMag * (0.85 + (post.id % 3) * 0.14);
        post.vry = sideSign * spinMag * 0.55;
        post.vrz = -sideSign * spinMag * 0.72;

        const wasUpright = !post.knocked;
        post.knocked = true;
        post.settled = false;
        post.hitCooldown = 0.22;

        // Subtle tactile speed bleed on vehicle when shearing a flexible bollard
        if (wasUpright) {
          car.vx *= 0.988;
          car.vz *= 0.988;
        }

        if (car.isPlayer) {
          const intensity = Math.min(1, Math.max(0.25, launchSpeed / 48));
          events.push({
            type: 'post-hit',
            intensity,
            x: post.x,
            y: post.y + 0.5,
            z: post.z,
          });
        }
        break;
      }
    }

    // 2. Integrate ballistic flight, 3D tumble rotation, gravity & ground bounce
    if (!post.knocked || post.settled) continue;

    const drag = Math.exp(-POST_PHYSICS.airDrag * dt);
    post.vx *= drag;
    post.vz *= drag;
    post.vy -= POST_PHYSICS.gravity * dt;

    post.x += post.vx * dt;
    post.y += post.vy * dt;
    post.z += post.vz * dt;

    post.rx += post.vrx * dt;
    post.ry += post.vry * dt;
    post.rz += post.vrz * dt;

    const floorY = groundHeightAt(track, post.x, post.z) + POST_PHYSICS.minGroundCenterY;
    if (post.y <= floorY) {
      post.y = floorY;
      if (Math.abs(post.vy) > 1.2) {
        post.vy = -post.vy * POST_PHYSICS.restitution;
      } else {
        post.vy = 0;
      }
      post.vx *= POST_PHYSICS.groundFriction;
      post.vz *= POST_PHYSICS.groundFriction;
      post.vrx *= 0.55;
      post.vry *= 0.55;
      post.vrz *= 0.55;

      const velSq = post.vx * post.vx + post.vy * post.vy + post.vz * post.vz;
      if (velSq < POST_PHYSICS.sleepVelSq) {
        post.vx = 0;
        post.vy = 0;
        post.vz = 0;
        post.vrx = 0;
        post.vry = 0;
        post.vrz = 0;
        // Rest naturally flat on the ground
        post.rx = Math.PI * 0.5;
        post.rz = 0;
        post.settled = true;
      }
    }
  }
}
