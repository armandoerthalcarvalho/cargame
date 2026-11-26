import * as THREE from 'three';
import { groundHeightAt, sampleTrackAtDistance } from '../game/track';
import type { TrackData } from '../game/track';
import { createRoadTextures, createStartBannerTexture } from './textures';

export interface ParticleSlot {
  active: boolean;
  life: number;
  maxLife: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  r: number;
  g: number;
  b: number;
}

export interface ParticlePool {
  mesh: THREE.InstancedMesh;
  emit: (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    scale: number,
    life: number,
    hexColor: number,
  ) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

export interface SkyAtmosphereConfig {
  topHex: string;
  midHex: string;
  horizonHex: string;
  sunHex: string;
  sunDir: THREE.Vector3;
  auroraStrength: number;
  starStrength: number;
}

export interface CourseEnvironment {
  group: THREE.Group;
  particles: ParticlePool;
  setAtmosphere: (cfg: SkyAtmosphereConfig) => void;
  update: (elapsed: number, dt: number, focusX: number, focusY: number, focusZ: number) => void;
  dispose: () => void;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ============================================================================
// Custom GLSL Shaders: Atmospheric Sky/Sun/Clouds/Aurora, Animated Ocean, Boost Pads
// ============================================================================

const SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(position);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTopColor;
uniform vec3 uMidColor;
uniform vec3 uHorizonColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uAuroraStrength;
uniform float uStarStrength;
varying vec3 vWorldDir;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise2(p);
    p *= 2.05;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float h = clamp(dir.y, 0.0, 1.0);

  // Smooth 3-stop atmospheric Rayleigh gradient
  vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));
  col = mix(col, uTopColor, smoothstep(0.22, 0.85, h));

  // Sun disc + warm Mie atmospheric halo
  vec3 sDir = normalize(uSunDir);
  float sunDot = max(dot(dir, sDir), 0.0);
  float sunHalo = pow(sunDot, 10.0) * 0.42 + pow(sunDot, 64.0) * 0.55;
  float sunDisc = smoothstep(0.9965, 0.9992, sunDot);
  col += uSunColor * (sunHalo + sunDisc * 1.45);

  // Drifting volumetric cloud bands
  if (dir.y > 0.02) {
    vec2 cloudUV = dir.xz / (dir.y + 0.16) * 0.95 + vec2(uTime * 0.012, uTime * 0.005);
    float c = fbm(cloudUV);
    float cloudMask = smoothstep(0.47, 0.78, c) * smoothstep(0.02, 0.22, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
    vec3 cloudLit = mix(uHorizonColor * 1.08, uSunColor * 1.12, pow(sunDot, 3.0) * 0.6 + 0.25);
    col = mix(col, cloudLit, cloudMask * 0.48);
  }

  // Flowing Aurora Borealis ribbons (Glacier Observatory & Twilight)
  if (uAuroraStrength > 0.01 && dir.y > 0.08) {
    vec2 aUV = dir.xz / (dir.y + 0.25);
    float wave = sin(aUV.x * 2.4 + uTime * 0.35 + sin(aUV.y * 1.8 - uTime * 0.25));
    float curtain = smoothstep(0.35, 0.95, wave * 0.5 + 0.5) * smoothstep(0.1, 0.42, dir.y) * (1.0 - smoothstep(0.5, 0.92, dir.y));
    float shimmer = fbm(aUV * 3.0 + vec2(uTime * 0.08, -uTime * 0.05));
    vec3 auroraCol = mix(vec3(0.08, 0.92, 0.64), vec3(0.24, 0.65, 1.0), shimmer);
    col += auroraCol * curtain * shimmer * 0.72 * uAuroraStrength;
  }

  // Subtle high-altitude twilight stars
  if (uStarStrength > 0.01 && dir.y > 0.18) {
    vec2 starGrid = floor(dir.xz / (dir.y + 0.1) * 140.0);
    float s = hash21(starGrid);
    if (s > 0.994) {
      float tw = 0.6 + 0.4 * sin(uTime * 2.5 + s * 80.0);
      col += vec3(0.92, 0.96, 1.0) * tw * uStarStrength * smoothstep(0.18, 0.5, dir.y);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 pos = position;
  float wave = sin(pos.x * 0.06 + uTime * 1.4) * 0.22 + cos(pos.z * 0.055 - uTime * 1.1) * 0.22;
  pos.y += wave;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec2 p = vWorldPos.xz * 0.075;
  float r1 = sin(p.x * 2.1 + uTime * 1.6 + cos(p.y * 1.8 - uTime * 1.1));
  float r2 = cos(p.y * 2.6 - uTime * 1.3 + sin(p.x * 1.7 + uTime * 0.9));
  vec3 n = normalize(vec3((r1 + r2) * 0.08, 1.0, (r2 - r1) * 0.08));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);

  vec3 base = mix(uDeepColor, uShallowColor, 0.45 + 0.35 * fresnel + 0.1 * r1);

  vec3 halfVec = normalize(normalize(uSunDir) + viewDir);
  float spec = pow(max(dot(n, halfVec), 0.0), 96.0);
  vec3 col = base + uSunColor * spec * 1.25;

  // Subtle sunlit sea-foam shimmer crests
  float foam = smoothstep(1.35, 1.85, r1 + r2);
  col = mix(col, vec3(0.92, 0.98, 1.0), foam * 0.14);

  gl_FragColor = vec4(col, 0.96);
}
`;

const BOOST_PAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BOOST_PAD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uAccent;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float scroll = fract(vUv.y * 3.5 - uTime * 2.8);
  float chevron = smoothstep(0.18, 0.04, abs(scroll - (1.0 - x) * 0.55));
  float edge = smoothstep(0.84, 0.98, x);
  vec3 bg = vec3(0.05, 0.1, 0.18);
  vec3 glow = mix(vec3(0.08, 0.92, 1.0), uAccent, 0.32);
  vec3 col = bg + glow * (chevron * 1.35 + edge * 0.85);
  gl_FragColor = vec4(col, 0.92);
}
`;

// ============================================================================
// Track Ribbon & Terrain Builders
// ============================================================================

function createTrackRibbonGeometry(
  track: TrackData,
  latMin: number,
  latMax: number,
  yOffset: number,
  uvRepeatLength: number,
): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const sample = samples[i % n];
    const sDist = i === n ? track.totalLength : sample.s;
    const vCoord = sDist / uvRepeatLength;

    const sinB = Math.sin(sample.bankAngle);
    const x0 = sample.pos.x + sample.right.x * latMin;
    const z0 = sample.pos.z + sample.right.z * latMin;
    const y0 = sample.pos.y + sinB * latMin + yOffset;

    const x1 = sample.pos.x + sample.right.x * latMax;
    const z1 = sample.pos.z + sample.right.z * latMax;
    const y1 = sample.pos.y + sinB * latMax + yOffset;

    const base = i * 6;
    positions[base] = x0;
    positions[base + 1] = y0;
    positions[base + 2] = z0;
    positions[base + 3] = x1;
    positions[base + 4] = y1;
    positions[base + 5] = z1;

    const uvBase = i * 4;
    uvs[uvBase] = 0;
    uvs[uvBase + 1] = vCoord;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = vCoord;

    if (i < n) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // Right-handed +Y upward facing winding: (b - a) x (c - a) points +Y
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createGuardrailGeometry(track: TrackData, lateral: number, height: number): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const sample = samples[i % n];
    const x = sample.pos.x + sample.right.x * lateral;
    const z = sample.pos.z + sample.right.z * lateral;
    const yBase = sample.pos.y + Math.sin(sample.bankAngle) * lateral - 0.1;

    const base = i * 6;
    positions[base] = x;
    positions[base + 1] = yBase;
    positions[base + 2] = z;
    positions[base + 3] = x;
    positions[base + 4] = yBase + height;
    positions[base + 5] = z;

    if (i < n) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createTerrainMesh(track: TrackData): THREE.Mesh {
  // Massive 1500m x 1500m sculpted landscape enclosing the full 2.2km+ circuits
  const size = 1500;
  const segs = 136;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const cx = (track.bounds.minX + track.bounds.maxX) * 0.5;
  const cz = (track.bounds.minZ + track.bounds.maxZ) * 0.5;
  geo.translate(cx, 0, cz);

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const cLow = new THREE.Color(track.course.terrainLow);
  const cMid = new THREE.Color(track.course.terrainMid);
  const cHigh = new THREE.Color(track.course.terrainHigh);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = groundHeightAt(track, x, z);
    posAttr.setY(i, y);

    const hNorm = Math.max(0, Math.min(1, (y + 6) / 38));
    if (hNorm < 0.5) {
      tmpColor.lerpColors(cLow, cMid, hNorm * 2);
    } else {
      tmpColor.lerpColors(cMid, cHigh, (hNorm - 0.5) * 2);
    }
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildStartingGantry(
  track: TrackData,
  sPos: number,
  bannerTex: THREE.CanvasTexture,
  startGridTex: THREE.CanvasTexture,
  accentHex: string,
): THREE.Group {
  const sample = sampleTrackAtDistance(track, sPos);
  const gantry = new THREE.Group();
  gantry.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
  gantry.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const span = track.course.roadWidth + 4.4;
  const halfSpan = span * 0.5;

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0xd9d4c9,
    roughness: 0.78,
    metalness: 0.08,
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1b212b,
    roughness: 0.34,
    metalness: 0.8,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.75,
    roughness: 0.25,
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex,
    roughness: 0.42,
    metalness: 0.1,
  });

  const pierGeo = new THREE.CylinderGeometry(0.68, 1.08, 9.8, 8);
  const leftPier = new THREE.Mesh(pierGeo, stoneMat);
  leftPier.position.set(-halfSpan, 4.5, 0);
  leftPier.castShadow = true;
  gantry.add(leftPier);

  const rightPier = new THREE.Mesh(pierGeo, stoneMat);
  rightPier.position.set(halfSpan, 4.5, 0);
  rightPier.castShadow = true;
  gantry.add(rightPier);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 2.4, 2.0, 1.5), darkMetalMat);
  beam.position.set(0, 9.0, 0);
  beam.castShadow = true;
  gantry.add(beam);

  const signGeo = new THREE.PlaneGeometry(14.4, 1.8);
  const frontSign = new THREE.Mesh(signGeo, bannerMat);
  frontSign.position.set(0, 9.0, -0.78);
  frontSign.rotation.y = Math.PI;
  gantry.add(frontSign);

  const backSign = new THREE.Mesh(signGeo, bannerMat);
  backSign.position.set(0, 9.0, 0.78);
  gantry.add(backSign);

  const lightBar = new THREE.Mesh(new THREE.BoxGeometry(span - 1.4, 0.18, 0.22), accentMat);
  lightBar.position.set(0, 7.9, 0);
  gantry.add(lightBar);

  // Checkered tarmac start/finish strip cleanly layered above asphalt
  const gridGeo = new THREE.PlaneGeometry(track.course.roadWidth - 0.6, 3.6);
  gridGeo.rotateX(-Math.PI / 2);
  const gridMat = new THREE.MeshStandardMaterial({
    map: startGridTex,
    roughness: 0.72,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const gridMesh = new THREE.Mesh(gridGeo, gridMat);
  gridMesh.position.y = 0.055;
  gantry.add(gridMesh);

  return gantry;
}

function buildCheckpointArch(track: TrackData, sPos: number, accentHex: string): THREE.Group {
  const sample = sampleTrackAtDistance(track, sPos);
  const arch = new THREE.Group();
  arch.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
  arch.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const halfSpan = track.course.roadWidth * 0.5 + 2.1;

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x262e3a,
    roughness: 0.4,
    metalness: 0.74,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.85,
    roughness: 0.25,
  });

  const postGeo = new THREE.BoxGeometry(0.55, 7.8, 0.75);
  const leftPost = new THREE.Mesh(postGeo, frameMat);
  leftPost.position.set(-halfSpan, 3.7, 0);
  arch.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, frameMat);
  rightPost.position.set(halfSpan, 3.7, 0);
  arch.add(rightPost);

  const topSpan = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 1.0, 0.55, 0.8), frameMat);
  topSpan.position.set(0, 7.5, 0);
  arch.add(topSpan);

  const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 1.85, 0.18, 0.88), glowMat);
  glowStrip.position.set(0, 7.16, 0);
  arch.add(glowStrip);

  return arch;
}

function buildInteractiveFeatures(
  track: TrackData,
  accentHex: string,
): {
  group: THREE.Group;
  boostPadUniforms: Array<{ uTime: { value: number } }>;
  apexRings: THREE.Object3D[];
} {
  const group = new THREE.Group();
  const boostPadUniforms: Array<{ uTime: { value: number } }> = [];
  const apexRings: THREE.Object3D[] = [];

  // Shared materials for ramps & rings
  const rampDeckMat = new THREE.MeshStandardMaterial({
    color: 0x1d2430,
    roughness: 0.55,
    metalness: 0.45,
  });
  const rampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffb020,
    emissive: 0xff9500,
    emissiveIntensity: 1.3,
    roughness: 0.2,
  });
  const ringOuterMat = new THREE.MeshStandardMaterial({
    color: 0x34f5c5,
    emissive: 0x10d4a2,
    emissiveIntensity: 1.4,
    roughness: 0.18,
    metalness: 0.5,
  });
  const ringInnerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });

  // Wedge ramp profile geometry (extruded across width)
  const rampShape = new THREE.Shape();
  rampShape.moveTo(-4.6, 0);
  rampShape.lineTo(4.6, 0);
  rampShape.lineTo(4.6, 1.15);
  rampShape.lineTo(-4.6, 0.08);
  rampShape.closePath();
  const rampGeo = new THREE.ExtrudeGeometry(rampShape, {
    depth: 5.4,
    bevelEnabled: false,
  });
  rampGeo.translate(0, 0, -2.7);
  rampGeo.rotateY(-Math.PI / 2);
  rampGeo.computeVertexNormals();

  const padGeo = new THREE.PlaneGeometry(4.8, 10.8);
  padGeo.rotateX(-Math.PI / 2);

  const ringOuterGeo = new THREE.TorusGeometry(3.35, 0.2, 10, 28);
  const ringInnerGeo = new THREE.TorusGeometry(2.75, 0.09, 8, 24);
  const rampRailGeo = new THREE.BoxGeometry(0.18, 0.26, 9.2);

  const accentCol = new THREE.Color(accentHex);

  for (const feat of track.features) {
    const holder = new THREE.Group();
    holder.position.set(feat.pos.x, feat.pos.y, feat.pos.z);
    holder.rotation.order = 'YXZ';
    holder.rotation.y = feat.heading;
    holder.rotation.z = -feat.bankAngle;

    if (feat.type === 'boost-pad') {
      const uniforms = {
        uTime: { value: 0 },
        uAccent: { value: accentCol.clone() },
      };
      boostPadUniforms.push(uniforms);
      const padMat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: BOOST_PAD_VERT,
        fragmentShader: BOOST_PAD_FRAG,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.position.y = 0.06;
      holder.add(padMesh);
    } else if (feat.type === 'jump-ramp') {
      const rampMesh = new THREE.Mesh(rampGeo, rampDeckMat);
      rampMesh.position.y = 0.03;
      holder.add(rampMesh);

      const leftRail = new THREE.Mesh(rampRailGeo, rampGlowMat);
      leftRail.position.set(-2.65, 0.72, 0);
      leftRail.rotation.x = -0.116;
      holder.add(leftRail);

      const rightRail = new THREE.Mesh(rampRailGeo, rampGlowMat);
      rightRail.position.set(2.65, 0.72, 0);
      rightRail.rotation.x = -0.116;
      holder.add(rightRail);

      const lipBar = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.16, 0.22), rampGlowMat);
      lipBar.position.set(0, 1.18, 4.55);
      holder.add(lipBar);
    } else if (feat.type === 'apex-ring') {
      const ringAssembly = new THREE.Group();
      ringAssembly.position.y = 3.55;
      const outer = new THREE.Mesh(ringOuterGeo, ringOuterMat);
      ringAssembly.add(outer);
      const inner = new THREE.Mesh(ringInnerGeo, ringInnerMat);
      ringAssembly.add(inner);
      holder.add(ringAssembly);
      apexRings.push(ringAssembly);
    }

    group.add(holder);
  }

  return { group, boostPadUniforms, apexRings };
}

function buildWorldLandmarks(track: TrackData): THREE.Group {
  const group = new THREE.Group();
  const style = track.course.landmarkStyle;

  if (style === 'canyon-arch') {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xb95c38, roughness: 0.9, metalness: 0.03 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd98c5b, roughness: 0.85, metalness: 0.04 });

    // Two monumental natural sandstone arches framing key straights
    for (const archS of [118, track.totalLength * 0.52]) {
      const archSample = sampleTrackAtDistance(track, archS);
      const naturalArch = new THREE.Group();
      naturalArch.position.set(archSample.pos.x, archSample.pos.y - 1.5, archSample.pos.z);
      naturalArch.rotation.y = Math.atan2(archSample.tangent.x, archSample.tangent.z);

      const pillarGeo = new THREE.CylinderGeometry(3.4, 5.8, 28, 7);
      const pL = new THREE.Mesh(pillarGeo, rockMat);
      pL.position.set(-18.5, 13, 0);
      pL.rotation.z = -0.1;
      naturalArch.add(pL);

      const pR = new THREE.Mesh(pillarGeo, rockMat);
      pR.position.set(18.5, 13, 0);
      pR.rotation.z = 0.1;
      naturalArch.add(pR);

      const bridgeSpan = new THREE.Mesh(new THREE.BoxGeometry(40, 5.8, 8.2), capMat);
      bridgeSpan.position.set(0, 25, 0);
      naturalArch.add(bridgeSpan);

      const crown = new THREE.Mesh(new THREE.BoxGeometry(30, 3.6, 6.6), rockMat);
      crown.position.set(0, 29, 0);
      naturalArch.add(crown);
      group.add(naturalArch);
    }

    const mesaCoords: Array<[number, number, number, number]> = [
      [112, 86, 30, 48],
      [-128, 135, 34, 58],
      [270, 230, 42, 68],
      [420, -40, 38, 60],
      [185, -360, 36, 54],
      [-105, -165, 28, 42],
    ];
    for (const [mx, mz, rad, h] of mesaCoords) {
      const gy = groundHeightAt(track, mx, mz);
      const mesa = new THREE.Group();
      mesa.position.set(mx, gy - 2, mz);
      // Extend base skirt 18m deep so cylindrical mesas never expose a floating edge on sloped hills
      const base = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.72, rad * 1.08, h * 0.65 + 18, 7), rockMat);
      base.position.y = h * 0.32 - 9;
      mesa.add(base);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.52, rad * 0.68, h * 0.42, 7), capMat);
      top.position.y = h * 0.78;
      mesa.add(top);
      group.add(mesa);
    }
  } else if (style === 'limestone-viaduct') {
    const limeMat = new THREE.MeshStandardMaterial({ color: 0xeae3d2, roughness: 0.78, metalness: 0.05 });
    const terraMat = new THREE.MeshStandardMaterial({ color: 0xc26546, roughness: 0.75, metalness: 0.06 });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xfff3c4,
      emissive: 0xffd275,
      emissiveIntensity: 1.6,
    });

    // Tall Mediterranean headland lighthouse
    const lhX = -76;
    const lhZ = 210;
    const lhY = Math.max(-2, groundHeightAt(track, lhX, lhZ));
    const lighthouse = new THREE.Group();
    lighthouse.position.set(lhX, lhY - 1, lhZ);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.6, 38, 12), limeMat);
    tower.position.y = 19;
    lighthouse.add(tower);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.4, 1.6, 12), terraMat);
    gallery.position.y = 38;
    lighthouse.add(gallery);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 4.6, 12), lanternMat);
    lantern.position.y = 41;
    lighthouse.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 4.2, 12), terraMat);
    roof.position.y = 45.2;
    lighthouse.add(roof);
    group.add(lighthouse);

    // Scenic whitewashed viaduct colonnade along the opening coastal stretch
    for (let i = 0; i < 10; i++) {
      const s = 72 + i * 32;
      const sample = sampleTrackAtDistance(track, s);
      const px = sample.pos.x - sample.right.x * 24;
      const pz = sample.pos.z - sample.right.z * 24;
      const py = groundHeightAt(track, px, pz);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.85, 18, 8), limeMat);
      col.position.set(px, py + 8, pz);
      group.add(col);
    }
  } else if (style === 'sakura-torii') {
    // Iconic vermilion Torii grand portals spanning the mountain skyway + Mount Solstice peak!
    const vermilionMat = new THREE.MeshStandardMaterial({
      color: 0xcf2626,
      roughness: 0.42,
      metalness: 0.12,
    });
    const darkCapMat = new THREE.MeshStandardMaterial({
      color: 0x1b1e26,
      roughness: 0.55,
      metalness: 0.25,
    });
    const lanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffe4b5,
      emissive: 0xff9e3b,
      emissiveIntensity: 1.5,
    });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.88 });

    const toriiFractions = [0.09, 0.34, 0.63, 0.88];
    const halfSpan = track.course.roadWidth * 0.5 + 3.4;

    for (const frac of toriiFractions) {
      const sample = sampleTrackAtDistance(track, track.totalLength * frac);
      const torii = new THREE.Group();
      torii.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
      torii.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

      const postGeo = new THREE.CylinderGeometry(0.62, 0.82, 13.5, 10);
      const pL = new THREE.Mesh(postGeo, vermilionMat);
      pL.position.set(-halfSpan, 6.5, 0);
      torii.add(pL);
      const pR = new THREE.Mesh(postGeo, vermilionMat);
      pR.position.set(halfSpan, 6.5, 0);
      torii.add(pR);

      // Lower nuki crossbeam
      const nuki = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 4.4, 0.9, 0.85), vermilionMat);
      nuki.position.set(0, 10.6, 0);
      torii.add(nuki);

      // Upper kasagi lintel + dark slate roof cap
      const kasagi = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 7.2, 1.25, 1.3), vermilionMat);
      kasagi.position.set(0, 13.0, 0);
      torii.add(kasagi);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 7.8, 0.55, 1.55), darkCapMat);
      cap.position.set(0, 13.85, 0);
      torii.add(cap);

      // Flanking glowing stone lanterns at gate feet
      for (const side of [-1, 1]) {
        const lx = side * (halfSpan + 2.2);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 1.1), stoneMat);
        base.position.set(lx, 1.1, -1.5);
        torii.add(base);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.95, 0.85), lanternGlowMat);
        lamp.position.set(lx, 2.65, -1.5);
        torii.add(lamp);
        const hood = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.8, 4), stoneMat);
        hood.position.set(lx, 3.5, -1.5);
        hood.rotation.y = Math.PI / 4;
        torii.add(hood);
      }

      group.add(torii);
    }

    // Distant iconic snow-capped volcanic mountain ("Mount Solstice") dominating the horizon
    const mountain = new THREE.Group();
    mountain.position.set(175, -10, 460);
    const slopeMat = new THREE.MeshStandardMaterial({ color: 0x3b4861, roughness: 0.9 });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fc, roughness: 0.72 });
    const mBase = new THREE.Mesh(new THREE.ConeGeometry(210, 155, 16), slopeMat);
    mBase.position.y = 75;
    mountain.add(mBase);
    const mSnow = new THREE.Mesh(new THREE.ConeGeometry(84, 62, 16), snowMat);
    mSnow.position.y = 123;
    mountain.add(mSnow);
    group.add(mountain);
  } else {
    // Glacier Observatory: illuminated brass-and-glass astronomical domes
    const domeWhite = new THREE.MeshStandardMaterial({ color: 0xd8e2ec, roughness: 0.35, metalness: 0.45 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a44a, roughness: 0.24, metalness: 0.88 });
    const slitGlow = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.5,
    });

    const domeLocations: Array<[number, number, number]> = [
      [56, 200, 18],
      [230, 82, 16],
      [-55, 92, 13],
      [215, -170, 15],
    ];
    for (const [dx, dz, radius] of domeLocations) {
      const gy = groundHeightAt(track, dx, dz);
      const obs = new THREE.Group();
      obs.position.set(dx, gy - 2, dz);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.15, radius * 0.9 + 14, 16), domeWhite);
      drum.position.y = radius * 0.45 - 7;
      obs.add(drum);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.01, 0.55, 8, 24), brassMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = radius * 0.92;
      obs.add(ring);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
        domeWhite,
      );
      dome.position.y = radius * 0.9;
      obs.add(dome);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.24, radius * 0.85, radius * 1.15), slitGlow);
      slit.position.set(0, radius * 1.32, radius * 0.12);
      obs.add(slit);
      group.add(obs);
    }
  }

  return group;
}

function createParticlePool(capacity = 220): ParticlePool {
  const geo = new THREE.IcosahedronGeometry(0.45, 0);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.frustumCulled = false;

  const slots: ParticleSlot[] = [];
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  for (let i = 0; i < capacity; i++) {
    slots.push({
      active: false,
      life: 0,
      maxLife: 1,
      x: 0,
      y: -999,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      scale: 0,
      r: 1,
      g: 1,
      b: 1,
    });
    dummy.position.set(0, -999, 0);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tmpColor.setHex(0xffffff));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  let cursor = 0;

  const emit = (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    scale: number,
    life: number,
    hexColor: number,
  ) => {
    const slot = slots[cursor];
    cursor = (cursor + 1) % capacity;
    slot.active = true;
    slot.life = life;
    slot.maxLife = Math.max(0.05, life);
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.scale = scale;
    tmpColor.setHex(hexColor);
    slot.r = tmpColor.r;
    slot.g = tmpColor.g;
    slot.b = tmpColor.b;
  };

  const update = (dt: number) => {
    let anyChanged = false;
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (!s.active) continue;
      anyChanged = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        dummy.position.set(0, -999, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.vx *= Math.exp(-2.4 * dt);
      s.vz *= Math.exp(-2.4 * dt);

      const t = s.life / s.maxLife;
      const curScale = s.scale * (0.35 + (1 - t) * 1.15) * Math.min(1, t * 2.5);
      dummy.position.set(s.x, s.y, s.z);
      dummy.scale.setScalar(Math.max(0.01, curScale));
      dummy.rotation.set(s.life * 2, s.life * 3, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tmpColor.setRGB(s.r, s.g, s.b));
    }
    if (anyChanged) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
  };

  return { mesh, emit, update, dispose };
}

export function buildCourseEnvironment(track: TrackData, maxAnisotropy: number): CourseEnvironment {
  const group = new THREE.Group();
  const ownedTextures: THREE.Texture[] = [];

  const course = track.course;
  const roadTex = createRoadTextures(
    course.asphaltTint,
    course.curbPrimary,
    course.curbSecondary,
    maxAnisotropy,
  );
  ownedTextures.push(roadTex.albedo, roadTex.bump, roadTex.curb, roadTex.startGrid);

  // 1. Procedural GLSL Atmospheric Sky Dome (Rayleigh + Sun + Clouds + Aurora + Stars)
  const skyUniforms = {
    uTopColor: { value: new THREE.Color(course.skyTop) },
    uMidColor: { value: new THREE.Color(course.skyMid) },
    uHorizonColor: { value: new THREE.Color(course.skyHorizon) },
    uSunColor: { value: new THREE.Color(course.sunColor) },
    uSunDir: {
      value: new THREE.Vector3(
        course.sunPosition.x,
        course.sunPosition.y,
        course.sunPosition.z,
      ).normalize(),
    },
    uTime: { value: 0 },
    uAuroraStrength: { value: course.hasAurora ? 1.0 : 0.0 },
    uStarStrength: { value: course.hasAurora ? 0.8 : 0.0 },
  };
  const skyGeo = new THREE.SphereGeometry(950, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  group.add(skyDome);

  // 2. Sculpted extended natural terrain skirt
  const terrain = createTerrainMesh(track);
  group.add(terrain);

  // 2b. Animated GLSL Turquoise Ocean Lagoon for Sunken Glass Coast
  let waterUniforms: {
    uTime: { value: number };
    uShallowColor: { value: THREE.Color };
    uDeepColor: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
  } | null = null;

  if (course.waterLevel !== null) {
    waterUniforms = {
      uTime: { value: 0 },
      uShallowColor: { value: new THREE.Color(course.waterColor) },
      uDeepColor: { value: new THREE.Color(course.waterDeepColor) },
      uSunColor: { value: new THREE.Color(course.sunColor) },
      uSunDir: { value: skyUniforms.uSunDir.value.clone() },
    };
    const waterGeo = new THREE.PlaneGeometry(1400, 1400, 56, 56);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(
      (track.bounds.minX + track.bounds.maxX) * 0.5,
      course.waterLevel,
      (track.bounds.minZ + track.bounds.maxZ) * 0.5,
    );
    group.add(waterMesh);
  }

  // 3. Banked asphalt road, curbs, shoulders & guardrails
  const halfRoad = course.roadWidth * 0.5;
  const shoulderOuter = halfRoad + course.shoulderWidth;

  const asphaltGeo = createTrackRibbonGeometry(track, -halfRoad, halfRoad, 0.02, 16);
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTex.albedo,
    bumpMap: roadTex.bump,
    bumpScale: 0.055,
    roughness: 0.8,
    metalness: 0.07,
  });
  const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
  asphaltMesh.receiveShadow = true;
  group.add(asphaltMesh);

  const curbWidth = 1.15;
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTex.curb,
    roughness: 0.72,
    metalness: 0.05,
  });
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, -halfRoad - curbWidth, -halfRoad + 0.04, 0.045, 5), curbMat));
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, halfRoad - 0.04, halfRoad + curbWidth, 0.045, 5), curbMat));

  const shoulderMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(course.terrainMid),
    roughness: 0.94,
    metalness: 0.02,
  });
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, -shoulderOuter - 0.6, -halfRoad - curbWidth + 0.05, -0.02, 12), shoulderMat));
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, halfRoad + curbWidth - 0.05, shoulderOuter + 0.6, -0.02, 12), shoulderMat));

  const railMat = new THREE.MeshStandardMaterial({
    color: 0xcbd3dc,
    roughness: 0.4,
    metalness: 0.6,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(createGuardrailGeometry(track, -shoulderOuter, 0.92), railMat));
  group.add(new THREE.Mesh(createGuardrailGeometry(track, shoulderOuter, 0.92), railMat));

  // 4. Starting Gantry + Checkered Grid + 7 Checkpoint Arches
  const bannerTex = createStartBannerTexture(course.name, course.accentHex, maxAnisotropy);
  ownedTextures.push(bannerTex);
  group.add(buildStartingGantry(track, 36, bannerTex, roadTex.startGrid, course.accentHex));

  for (let c = 1; c < track.checkpointCount; c++) {
    group.add(buildCheckpointArch(track, track.checkpointDistances[c], course.accentHex));
  }

  // 5. Interactive Track Features (Boost Pads, Jump Ramps, Apex Rings)
  const featureBuild = buildInteractiveFeatures(track, course.accentHex);
  group.add(featureBuild.group);

  // 6. Signature World Landmarks
  group.add(buildWorldLandmarks(track));

  // 7. Instanced Scenic Trees (including Blossom Sakura crowns!) & Sculpted Boulders
  const rand = seededRand(course.id.length * 733 + 31);
  const treePositions: Array<{ x: number; y: number; z: number; scale: number; rotY: number }> = [];
  const rockPositions: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; rotY: number }> = [];

  for (let i = 0; i < track.samples.length; i += 4) {
    const s = track.samples[i];
    for (const side of [-1, 1]) {
      const dist = shoulderOuter + 6 + rand() * 38;
      const x = s.pos.x + s.right.x * side * dist;
      const z = s.pos.z + s.right.z * side * dist;
      const y = groundHeightAt(track, x, z);
      if (course.waterLevel !== null && y < course.waterLevel + 2.2) continue;

      if (rand() < 0.72) {
        treePositions.push({ x, y, z, scale: 0.88 + rand() * 0.42, rotY: rand() * Math.PI * 2 });
      } else {
        rockPositions.push({
          x,
          y: y - 0.35,
          z,
          sx: 1.5 + rand() * 3.0,
          sy: 1.0 + rand() * 2.6,
          sz: 1.5 + rand() * 2.8,
          rotY: rand() * Math.PI * 2,
        });
      }
    }
  }

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.4, 2.8, 6);
    trunkGeo.translate(0, 1.4, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x523929, roughness: 0.92 });

    const isSakura = course.treeStyle === 'sakura';
    const crownHeight = course.treeStyle === 'cypress' ? 7.6 : course.treeStyle === 'pine' ? 6.0 : 4.0;
    const crownRadius = course.treeStyle === 'cypress' ? 1.3 : course.treeStyle === 'pine' ? 2.2 : 2.6;

    const crown1Geo = isSakura
      ? new THREE.DodecahedronGeometry(2.6, 1)
      : new THREE.ConeGeometry(crownRadius, crownHeight, 7);
    crown1Geo.translate(0, isSakura ? 4.3 : 2.3 + crownHeight * 0.45, 0);

    const crown2Geo = isSakura
      ? new THREE.DodecahedronGeometry(1.9, 1)
      : new THREE.ConeGeometry(crownRadius * 0.72, crownHeight * 0.7, 7);
    crown2Geo.translate(isSakura ? 1.1 : 0, isSakura ? 5.2 : 3.3 + crownHeight * 0.7, isSakura ? 0.6 : 0);

    const baseFoliageHex = isSakura
      ? 0xffa8c8
      : course.treeStyle === 'juniper'
        ? 0x4b6e43
        : course.treeStyle === 'cypress'
          ? 0x2d5e47
          : 0x2c4e4a;
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: isSakura ? 0.78 : 0.84 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    const crowns1 = new THREE.InstancedMesh(crown1Geo, foliageMat, treePositions.length);
    const crowns2 = new THREE.InstancedMesh(crown2Geo, foliageMat, treePositions.length);

    const baseCol = new THREE.Color(baseFoliageHex);
    treePositions.forEach((tp, idx) => {
      dummy.position.set(tp.x, tp.y - 0.1, tp.z);
      dummy.rotation.set(0, tp.rotY, 0);
      dummy.scale.setScalar(tp.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(idx, dummy.matrix);
      crowns1.setMatrixAt(idx, dummy.matrix);
      crowns2.setMatrixAt(idx, dummy.matrix);

      tintColor.copy(baseCol).offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08);
      crowns1.setColorAt(idx, tintColor);
      crowns2.setColorAt(idx, tintColor.clone().offsetHSL(0, 0, 0.05));
    });

    trunks.instanceMatrix.needsUpdate = true;
    crowns1.instanceMatrix.needsUpdate = true;
    crowns2.instanceMatrix.needsUpdate = true;
    if (crowns1.instanceColor) crowns1.instanceColor.needsUpdate = true;
    if (crowns2.instanceColor) crowns2.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    crowns1.computeBoundingSphere();
    crowns2.computeBoundingSphere();

    group.add(trunks, crowns1, crowns2);
  }

  if (rockPositions.length > 0) {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.translate(0, 0.65, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockPositions.length);
    const baseRock = new THREE.Color(course.terrainLow);

    rockPositions.forEach((rp, idx) => {
      dummy.position.set(rp.x, rp.y, rp.z);
      dummy.rotation.set(0, rp.rotY, 0);
      dummy.scale.set(rp.sx, rp.sy, rp.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(idx, dummy.matrix);
      tintColor.copy(baseRock).offsetHSL(0, (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.12);
      rocks.setColorAt(idx, tintColor);
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
    group.add(rocks);
  }

  // 8. Roadside reflective guide posts
  const postStep = 7;
  const postCount = Math.floor(track.samples.length / postStep) * 2;
  const postGeo = new THREE.BoxGeometry(0.18, 1.15, 0.18);
  postGeo.translate(0, 0.57, 0);
  const postMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(course.accentHex),
    emissive: new THREE.Color(course.accentHex),
    emissiveIntensity: 0.45,
    roughness: 0.35,
  });
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
  let pIdx = 0;
  for (let i = 0; i < track.samples.length && pIdx < postCount - 1; i += postStep) {
    const s = track.samples[i];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      const lat = side * (shoulderOuter + 0.25);
      dummy.position.set(
        s.pos.x + s.right.x * lat,
        s.pos.y + Math.sin(s.bankAngle) * lat,
        s.pos.z + s.right.z * lat,
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      posts.setMatrixAt(pIdx++, dummy.matrix);
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.computeBoundingSphere();
  group.add(posts);

  // 9. Ambient World Atmosphere Motes (Sakura Petals / Snow / Desert Sun Dust / Coastal Mist)
  const isPetal = course.treeStyle === 'sakura';
  const isSnow = course.treeStyle === 'pine';
  const isHighAltitudeParticle = isPetal || isSnow;
  const ambientCount = isHighAltitudeParticle ? 160 : 90;
  const ambientMaxHeight = isHighAltitudeParticle ? 18 : 6.5;
  const ambientGeo = isPetal
    ? new THREE.PlaneGeometry(0.28, 0.16)
    : new THREE.OctahedronGeometry(isSnow ? 0.11 : 0.065, 0);
  const ambientMat = new THREE.MeshBasicMaterial({
    color: course.ambientParticleColor,
    transparent: true,
    opacity: isPetal ? 0.85 : isSnow ? 0.68 : 0.34,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ambientMesh = new THREE.InstancedMesh(ambientGeo, ambientMat, ambientCount);
  ambientMesh.frustumCulled = false;

  const ambientOffsets: Array<{ ox: number; oy: number; oz: number; phase: number; speed: number }> = [];
  for (let i = 0; i < ambientCount; i++) {
    ambientOffsets.push({
      ox: (rand() - 0.5) * 90,
      oy: 0.8 + rand() * ambientMaxHeight,
      oz: (rand() - 0.5) * 90,
      phase: rand() * Math.PI * 2,
      speed: 0.6 + rand() * 1.1,
    });
  }
  group.add(ambientMesh);

  // 10. Pooled zero-GC gameplay particle ring buffer
  const particles = createParticlePool(220);
  group.add(particles.mesh);

  const setAtmosphere = (cfg: SkyAtmosphereConfig) => {
    skyUniforms.uTopColor.value.set(cfg.topHex);
    skyUniforms.uMidColor.value.set(cfg.midHex);
    skyUniforms.uHorizonColor.value.set(cfg.horizonHex);
    skyUniforms.uSunColor.value.set(cfg.sunHex);
    skyUniforms.uSunDir.value.copy(cfg.sunDir).normalize();
    skyUniforms.uAuroraStrength.value = cfg.auroraStrength;
    skyUniforms.uStarStrength.value = cfg.starStrength;

    if (waterUniforms) {
      waterUniforms.uSunColor.value.set(cfg.sunHex);
      waterUniforms.uSunDir.value.copy(cfg.sunDir).normalize();
    }
  };

  const update = (elapsed: number, dt: number, focusX: number, focusY: number, focusZ: number) => {
    skyUniforms.uTime.value = elapsed;
    if (waterUniforms) {
      waterUniforms.uTime.value = elapsed;
    }
    for (const u of featureBuild.boostPadUniforms) {
      u.uTime.value = elapsed;
    }
    for (let i = 0; i < featureBuild.apexRings.length; i++) {
      const ring = featureBuild.apexRings[i];
      ring.rotation.z = elapsed * 1.4 + i;
      ring.position.y = 3.55 + Math.sin(elapsed * 2.4 + i) * 0.28;
    }

    // Drift ambient world particles gently around player's current horizon corridor
    for (let i = 0; i < ambientCount; i++) {
      const a = ambientOffsets[i];
      const fall = isHighAltitudeParticle ? (elapsed * 1.6 * a.speed) % ambientMaxHeight : 0;
      const wx = focusX + a.ox + Math.sin(elapsed * 0.7 * a.speed + a.phase) * 3.5;
      const wy =
        focusY + ((a.oy - fall + ambientMaxHeight) % ambientMaxHeight) + 0.6;
      const wz = focusZ + a.oz + Math.cos(elapsed * 0.6 * a.speed + a.phase) * 3.5;
      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(elapsed * a.speed, elapsed * 1.3 + a.phase, a.phase);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      ambientMesh.setMatrixAt(i, dummy.matrix);
    }
    ambientMesh.instanceMatrix.needsUpdate = true;

    particles.update(dt);
  };

  const dispose = () => {
    particles.dispose();
    const seenGeos = new Set<THREE.BufferGeometry>();
    const seenMats = new Set<THREE.Material>();
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        if (obj.geometry && !seenGeos.has(obj.geometry)) {
          seenGeos.add(obj.geometry);
          obj.geometry.dispose();
        }
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m && !seenMats.has(m)) {
            seenMats.add(m);
            m.dispose();
          }
        }
      }
    });
    for (const tex of ownedTextures) {
      tex.dispose();
    }
  };

  return { group, particles, setAtmosphere, update, dispose };
}
