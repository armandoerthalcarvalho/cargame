import * as THREE from 'three';
import { COURSE_LANDMARKS, computeLandmarkTrackClearance } from '../game/landmarks';
import { groundHeightAt, sampleTrackAtDistance } from '../game/track';
import type { TrackData } from '../game/track';
import type { RoadsidePostState } from '../game/types';
import {
  createBrakingSignTexture,
  createChevronSignTexture,
  createConcreteFormworkTexture,
  createDelineatorPostTexture,
  createFoliageTextures,
  createPennantFlagTexture,
  createPitBayHeaderTexture,
  createRoadTextures,
  createSponsorBoardTexture,
  createStartBannerTexture,
  createTerrainDetailTextures,
  createTimberSoffitTexture,
  createTimingTowerTexture,
} from './textures';

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

export interface SkidmarkPool {
  mesh: THREE.InstancedMesh;
  stamp: (
    x: number,
    y: number,
    z: number,
    heading: number,
    bankAngle: number,
    length: number,
    width: number,
  ) => void;
  clear: () => void;
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
  skidmarks: SkidmarkPool;
  syncPosts: (posts: RoadsidePostState[]) => void;
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
// Calibrated Natural GLSL Shaders (Zero Blinding Glare, Cinematic Atmosphere)
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

  // Smooth Rayleigh atmospheric zenith-to-horizon gradient with warm horizon airglow band
  vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.26, h));
  col = mix(col, uTopColor, smoothstep(0.20, 0.84, h));

  // Natural non-blinding solar disc + layered Mie scattering aureole
  vec3 sDir = normalize(uSunDir);
  float sunDot = max(dot(dir, sDir), 0.0);
  float sunHalo = pow(sunDot, 7.0) * 0.14 + pow(sunDot, 44.0) * 0.22;
  float sunDisc = smoothstep(0.9974, 0.9994, sunDot);
  float horizonGlow = exp(-abs(dir.y) * 9.0) * (0.12 + 0.18 * pow(sunDot, 2.5));
  col += uSunColor * (sunHalo + sunDisc * 0.52 + horizonGlow * 0.20);

  // Volumetric 3D-lit cumulus clouds (sampled with directional sun-offset shading) + wispy cirrus
  if (dir.y > 0.014) {
    vec2 cloudUV = dir.xz / (dir.y + 0.155) * 0.92 + vec2(uTime * 0.0085, uTime * 0.0028);
    float c1 = fbm(cloudUV);
    float c2 = fbm(cloudUV * 2.35 - vec2(uTime * 0.0055, -uTime * 0.0038));
    float density = smoothstep(0.45, 0.78, c1 * 0.70 + c2 * 0.36);

    // Directional self-shadow offset toward the sun for realistic sunlit crests & shaded bellies
    vec2 sunStep = normalize(sDir.xz + vec2(0.001)) * 0.14;
    float cSun = fbm(cloudUV + sunStep);
    float litRidge = clamp(0.55 + (c1 - cSun) * 2.4 + pow(sunDot, 2.0) * 0.35, 0.0, 1.0);

    float fade = smoothstep(0.014, 0.17, dir.y) * (1.0 - smoothstep(0.56, 0.94, dir.y));
    float cloudMask = density * fade;
    vec3 cloudShadow = mix(uMidColor * 0.66, uHorizonColor * 0.76, 0.38);
    vec3 cloudBright = mix(uHorizonColor * 0.98, uSunColor * 1.05, pow(sunDot, 3.0) * 0.54 + 0.22);
    float silverLining = smoothstep(0.42, 0.64, c1) * (1.0 - smoothstep(0.64, 0.86, c1)) * pow(sunDot, 4.5);
    vec3 cloudCol = mix(cloudShadow, cloudBright, litRidge) + uSunColor * silverLining * 0.26;
    col = mix(col, cloudCol, cloudMask * 0.62);

    vec2 cirrusUV = dir.xz / (dir.y + 0.32) * vec2(2.05, 0.62) + vec2(uTime * 0.0045, 0.0);
    float cirrus = smoothstep(0.58, 0.84, fbm(cirrusUV)) * smoothstep(0.15, 0.44, dir.y) * 0.18;
    col = mix(col, mix(uHorizonColor, uSunColor, 0.38) * 0.96, cirrus);
  }

  // Calm Aurora Borealis curtains (Glacier & Twilight)
  if (uAuroraStrength > 0.01 && dir.y > 0.08) {
    vec2 aUV = dir.xz / (dir.y + 0.24);
    float wave = sin(aUV.x * 2.5 + uTime * 0.32 + sin(aUV.y * 1.9 - uTime * 0.22));
    float wave2 = cos(aUV.x * 1.6 - uTime * 0.2 + sin(aUV.y * 2.2 + uTime * 0.16));
    float curtain = smoothstep(0.35, 0.95, (wave * 0.65 + wave2 * 0.35) * 0.5 + 0.5)
      * smoothstep(0.09, 0.4, dir.y)
      * (1.0 - smoothstep(0.52, 0.92, dir.y));
    float shimmer = fbm(aUV * 3.1 + vec2(uTime * 0.07, -uTime * 0.05));
    vec3 auroraCol = mix(vec3(0.08, 0.72, 0.54), vec3(0.22, 0.48, 0.82), shimmer);
    col += auroraCol * curtain * shimmer * 0.44 * uAuroraStrength;
  }

  // Celestial Twilight Sky: Milky Way dust ribbon, crescent moon & multi-tinted twinkling stars
  if (uStarStrength > 0.01 && dir.y > 0.10) {
    float zenithVis = smoothstep(0.10, 0.44, dir.y);
    // Soft diagonal Milky Way band
    float bandDist = abs(dir.x * 0.58 - dir.z * 0.52 + dir.y * 0.28 - 0.14);
    float mwCore = exp(-bandDist * 7.5) * fbm(dir.xz * 4.2 + vec2(1.7, 3.1));
    col += vec3(0.18, 0.24, 0.38) * mwCore * 0.42 * uStarStrength * zenithVis;

    // Crisp Crescent Moon opposite the sun
    vec3 moonDir = normalize(vec3(-sDir.x * 0.82, 0.46, -sDir.z * 0.82));
    float mDot = dot(dir, moonDir);
    float moonDisc = smoothstep(0.9983, 0.9989, mDot);
    vec3 shadowDir = normalize(moonDir + vec3(0.022, 0.012, 0.0));
    float moonCut = smoothstep(0.9981, 0.9987, dot(dir, shadowDir));
    float crescent = max(0.0, moonDisc - moonCut * 0.92);
    float moonGlow = pow(max(mDot, 0.0), 90.0) * 0.16;
    col += vec3(0.88, 0.91, 0.98) * (crescent * 0.78 + moonGlow) * uStarStrength;

    // Twinkling starfield
    vec2 starGrid = floor(dir.xz / (dir.y + 0.1) * 175.0);
    float s = hash21(starGrid);
    if (s > 0.9935) {
      float tw = 0.58 + 0.34 * sin(uTime * 2.6 + s * 95.0);
      vec3 starTint = mix(vec3(0.78, 0.86, 0.98), vec3(0.98, 0.88, 0.74), fract(s * 31.7));
      col += starTint * tw * 0.72 * uStarStrength * zenithVis;
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
  float wave = sin(pos.x * 0.058 + uTime * 1.25) * 0.22
    + cos(pos.z * 0.052 - uTime * 0.95) * 0.22
    + sin((pos.x + pos.z) * 0.032 + uTime * 0.8) * 0.12;
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
uniform vec3 uHorizonColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec2 p = vWorldPos.xz * 0.075;
  float r1 = sin(p.x * 2.1 + uTime * 1.45 + cos(p.y * 1.85 - uTime * 1.05));
  float r2 = cos(p.y * 2.65 - uTime * 1.15 + sin(p.x * 1.75 + uTime * 0.9));
  float r3 = sin((p.x - p.y) * 4.4 + uTime * 2.1) * 0.45;
  float r4 = cos((p.x + p.y) * 6.8 - uTime * 2.5) * 0.22;
  vec3 n = normalize(vec3((r1 + r2 + r3 + r4) * 0.078, 1.0, (r2 - r1 + r3 - r4) * 0.078));

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.6);

  // Subtle underwater turquoise caustic shimmer
  float caustic = pow(max(0.0, sin(p.x * 5.2 + uTime * 1.7) * cos(p.y * 5.6 - uTime * 1.4)), 2.0);
  vec3 waterBody = mix(uDeepColor, uShallowColor, clamp(0.36 + 0.38 * fresnel + 0.12 * r1, 0.0, 1.0));
  waterBody += uShallowColor * caustic * 0.16 * (1.0 - fresnel);

  // Natural Fresnel reflection of the live sky horizon
  vec3 base = mix(waterBody, uHorizonColor * 0.92, clamp(fresnel * 0.56, 0.0, 0.62));

  vec3 halfVec = normalize(normalize(uSunDir) + viewDir);
  float specBroad = pow(max(dot(n, halfVec), 0.0), 46.0) * 0.18;
  float specSharp = pow(max(dot(n, halfVec), 0.0), 185.0) * 0.62;
  vec3 col = base + uSunColor * (specBroad + specSharp);

  // Dynamic crest & shoreline seafoam lacing
  float foam = smoothstep(1.36, 1.98, r1 + r2 + r3 * 0.55);
  col = mix(col, vec3(0.88, 0.94, 0.97), foam * 0.22);

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
  float scroll = fract(vUv.y * 3.5 - uTime * 2.6);
  float chevron = smoothstep(0.18, 0.04, abs(scroll - (1.0 - x) * 0.55));
  float edge = smoothstep(0.86, 0.98, x);
  vec3 bg = vec3(0.06, 0.09, 0.14);
  vec3 glow = mix(vec3(0.1, 0.72, 0.85), uAccent, 0.35);
  vec3 col = bg + glow * (chevron * 0.62 + edge * 0.38);
  gl_FragColor = vec4(col, 0.9);
}
`;

// ============================================================================
// Track Ribbon, Armco W-Beam Barriers & Slope-Aware Mountain Terrain
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

function createGuardrailBandGeometry(
  track: TrackData,
  lateral: number,
  yBottom: number,
  yTop: number,
): THREE.BufferGeometry {
  const samples = track.samples;
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const sample = samples[i % n];
    const x = sample.pos.x + sample.right.x * lateral;
    const z = sample.pos.z + sample.right.z * lateral;
    const yBase = sample.pos.y + Math.sin(sample.bankAngle) * lateral;

    const base = i * 6;
    positions[base] = x;
    positions[base + 1] = yBase + yBottom;
    positions[base + 2] = z;
    positions[base + 3] = x;
    positions[base + 4] = yBase + yTop;
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

function createTerrainMesh(
  track: TrackData,
  detailAlbedo: THREE.CanvasTexture,
  detailBump: THREE.CanvasTexture,
): THREE.Mesh {
  // High-resolution 1640m x 1640m sculpted geological mountain & valley terrain
  const size = 1640;
  const segs = 168;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const cx = (track.bounds.minX + track.bounds.maxX) * 0.5;
  const cz = (track.bounds.minZ + track.bounds.maxZ) * 0.5;
  geo.translate(cx, 0, cz);

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, groundHeightAt(track, x, z));
  }

  // Compute accurate surface normals first so we can shade steep mountain cliffs with exposed rock!
  geo.computeVertexNormals();
  const normAttr = geo.attributes.normal as THREE.BufferAttribute;

  const colors = new Float32Array(posAttr.count * 3);
  const cLow = new THREE.Color(track.course.terrainLow);
  const cMid = new THREE.Color(track.course.terrainMid);
  const cHigh = new THREE.Color(track.course.terrainHigh);
  const cCliff = new THREE.Color(
    track.course.id === 'sunstone-canyon'
      ? 0x612a18
      : track.course.id === 'sunken-coast'
        ? 0x7c7464
        : track.course.id === 'sakura-skyway'
          ? 0x3f454f
          : 0x2e3e52,
  );
  const cPeakSnow = new THREE.Color(
    track.course.id === 'glacier-observatory'
      ? 0xdce6f0
      : track.course.id === 'sakura-skyway'
        ? 0xcbd4df
        : track.course.terrainHigh,
  );
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const ny = Math.max(0, Math.min(1, normAttr.getY(i)));

    const hNorm = Math.max(0, Math.min(1, (y + 6) / 48));
    if (hNorm < 0.45) {
      tmpColor.lerpColors(cLow, cMid, hNorm / 0.45);
    } else {
      tmpColor.lerpColors(cMid, cHigh, (hNorm - 0.45) / 0.55);
    }

    // Blend exposed dark geological cliff rock on steep mountain faces
    const steepness = Math.max(0, Math.min(1, (0.93 - ny) / 0.24));
    if (steepness > 0.01) {
      tmpColor.lerp(cCliff, steepness * 0.82);
    }

    // Subtle snow dusting on high mountain crests (Glacier & tall Sakura peaks)
    if (y > 46 && (track.course.id === 'glacier-observatory' || track.course.id === 'sakura-skyway')) {
      const snowBlend = Math.min(1, (y - 46) / 34) * Math.max(0, (ny - 0.55) / 0.45);
      tmpColor.lerp(cPeakSnow, snowBlend * 0.82);
    }

    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: detailAlbedo,
    bumpMap: detailBump,
    bumpScale: 0.72,
    roughness: 0.94,
    metalness: 0.02,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ============================================================================
// Trussed Start/Finish Gantry + FIA 5-Pod Start Lights + Painted Grid Slots
// ============================================================================

function buildStartingGantry(
  track: TrackData,
  sPos: number,
  bannerTex: THREE.CanvasTexture,
  startGridTex: THREE.CanvasTexture,
  concreteTex: { albedo: THREE.CanvasTexture; bump: THREE.CanvasTexture },
  accentHex: string,
): THREE.Group {
  const sample = sampleTrackAtDistance(track, sPos);
  const gantry = new THREE.Group();
  gantry.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
  gantry.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const halfSpan = track.course.roadWidth * 0.5 + track.course.shoulderWidth + 1.85;
  const span = halfSpan * 2;

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteTex.albedo,
    bumpMap: concreteTex.bump,
    bumpScale: 0.18,
    roughness: 0.88,
    metalness: 0.05,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x262d38, roughness: 0.45, metalness: 0.78 });
  const galvMat = new THREE.MeshStandardMaterial({ color: 0x7e8794, roughness: 0.48, metalness: 0.72 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.32,
    roughness: 0.32,
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex,
    roughness: 0.52,
    metalness: 0.08,
  });
  const podRedMat = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    emissive: 0xdc2626,
    emissiveIntensity: 0.52,
    roughness: 0.25,
  });

  // Heavy cast-concrete footing bases + twin lattice truss pier towers
  const footingGeo = new THREE.BoxGeometry(2.4, 1.8, 2.6);
  const vertGeo = new THREE.BoxGeometry(0.24, 9.6, 0.24);
  const braceGeo = new THREE.BoxGeometry(0.14, 2.0, 0.14);

  for (const side of [-1, 1]) {
    const px = side * halfSpan;
    const footing = new THREE.Mesh(footingGeo, concreteMat);
    footing.position.set(px, 0.6, 0);
    footing.castShadow = true;
    gantry.add(footing);

    // 4-corner steel truss column tower
    for (const ox of [-0.55, 0.55]) {
      for (const oz of [-0.55, 0.55]) {
        const leg = new THREE.Mesh(vertGeo, steelMat);
        leg.position.set(px + ox, 5.2, oz);
        leg.castShadow = true;
        gantry.add(leg);
      }
    }
    // Horizontal truss rungs & diagonal bracing along pier height
    for (let y = 2.0; y <= 8.5; y += 2.1) {
      const rungX = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.14), galvMat);
      rungX.position.set(px, y, 0.55);
      gantry.add(rungX);
      const rungX2 = rungX.clone();
      rungX2.position.z = -0.55;
      gantry.add(rungX2);

      const diag = new THREE.Mesh(braceGeo, galvMat);
      diag.position.set(px, y + 0.9, 0.55);
      diag.rotation.z = 0.58;
      gantry.add(diag);
    }
  }

  // Overhead trussed steel bridge + circuit signboard
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 2.6, 2.0, 1.5), steelMat);
  beam.position.set(0, 9.2, 0);
  beam.castShadow = true;
  gantry.add(beam);

  const catwalkRail = new THREE.Mesh(new THREE.BoxGeometry(span + 2.2, 0.12, 0.12), galvMat);
  catwalkRail.position.set(0, 10.6, 0.72);
  gantry.add(catwalkRail);
  const catwalkRailB = catwalkRail.clone();
  catwalkRailB.position.z = -0.72;
  gantry.add(catwalkRailB);

  const signGeo = new THREE.PlaneGeometry(14.8, 1.8);
  const frontSign = new THREE.Mesh(signGeo, bannerMat);
  frontSign.position.set(0, 9.2, -0.77);
  frontSign.rotation.y = Math.PI;
  gantry.add(frontSign);

  const backSign = new THREE.Mesh(signGeo, bannerMat);
  backSign.position.set(0, 9.2, 0.77);
  gantry.add(backSign);

  const accentTrim = new THREE.Mesh(new THREE.BoxGeometry(span - 1.4, 0.14, 0.18), accentMat);
  accentTrim.position.set(0, 8.1, 0);
  gantry.add(accentTrim);

  // 5 Suspended FIA Motorsport Starting Light Pods beneath gantry
  const podHousingGeo = new THREE.BoxGeometry(0.68, 1.15, 0.36);
  const podLampGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10);
  podLampGeo.rotateX(Math.PI / 2);
  for (let i = -2; i <= 2; i++) {
    const px = i * 1.45;
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.1), galvMat);
    stalk.position.set(px, 7.85, 0);
    gantry.add(stalk);

    const pod = new THREE.Mesh(podHousingGeo, steelMat);
    pod.position.set(px, 7.1, 0);
    gantry.add(pod);

    for (const ly of [-0.24, 0.24]) {
      const lamp = new THREE.Mesh(podLampGeo, podRedMat);
      lamp.position.set(px, 7.1 + ly, -0.17);
      gantry.add(lamp);
    }
  }

  // Checkered tarmac start/finish strip cleanly layered above asphalt
  const gridGeo = new THREE.PlaneGeometry(track.course.roadWidth - 0.6, 3.6);
  gridGeo.rotateX(-Math.PI / 2);
  const gridMat = new THREE.MeshStandardMaterial({
    map: startGridTex,
    roughness: 0.86,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const gridMesh = new THREE.Mesh(gridGeo, gridMat);
  gridMesh.position.y = 0.055;
  gantry.add(gridMesh);

  // Painted white staggered starting grid slot brackets (P1-P4) behind the start line
  const slotMat = new THREE.MeshStandardMaterial({
    color: 0xd8d4ca,
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const barFrontGeo = new THREE.PlaneGeometry(2.6, 0.22);
  barFrontGeo.rotateX(-Math.PI / 2);
  const barSideGeo = new THREE.PlaneGeometry(0.22, 1.4);
  barSideGeo.rotateX(-Math.PI / 2);

  const gridSlots: Array<[number, number]> = [
    [-3.2, -10],
    [3.2, -17],
    [-3.2, -24],
    [3.2, -31],
  ];
  for (const [gx, gz] of gridSlots) {
    const fBar = new THREE.Mesh(barFrontGeo, slotMat);
    fBar.position.set(gx, 0.052, gz);
    gantry.add(fBar);
    const lBar = new THREE.Mesh(barSideGeo, slotMat);
    lBar.position.set(gx - 1.2, 0.052, gz - 0.65);
    gantry.add(lBar);
    const rBar = new THREE.Mesh(barSideGeo, slotMat);
    rBar.position.set(gx + 1.2, 0.052, gz - 0.65);
    gantry.add(rBar);
  }

  return gantry;
}

function buildCheckpointArch(track: TrackData, sPos: number, accentHex: string): THREE.Group {
  const sample = sampleTrackAtDistance(track, sPos);
  const arch = new THREE.Group();
  arch.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
  arch.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const halfSpan = track.course.roadWidth * 0.5 + track.course.shoulderWidth + 1.45;

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x242c38,
    roughness: 0.44,
    metalness: 0.74,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.34,
    roughness: 0.32,
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

  const trimStrip = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 1.85, 0.15, 0.86), accentMat);
  trimStrip.position.set(0, 7.16, 0);
  arch.add(trimStrip);

  return arch;
}

// ============================================================================
// Multi-Level Architectural Pit Complex & Race Control Station
// ============================================================================

function buildRaceControlStation(
  track: TrackData,
  sPos: number,
  timingTex: THREE.CanvasTexture,
  pitHeaderTex: THREE.CanvasTexture,
  concreteTex: { albedo: THREE.CanvasTexture; bump: THREE.CanvasTexture },
  timberSoffitTex: THREE.CanvasTexture,
  accentHex: string,
): { group: THREE.Group; radarDish: THREE.Object3D } {
  const sample = sampleTrackAtDistance(track, sPos);
  const halfRoad = track.course.roadWidth * 0.5 + track.course.shoulderWidth;
  const latOffset = halfRoad + 10.6;

  const px = sample.pos.x + sample.right.x * latOffset;
  const pz = sample.pos.z + sample.right.z * latOffset;
  const gy = Math.min(sample.pos.y, groundHeightAt(track, px, pz));

  const station = new THREE.Group();
  station.position.set(px, gy, pz);
  station.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteTex.albedo,
    bumpMap: concreteTex.bump,
    bumpScale: 0.22,
    roughness: 0.88,
    metalness: 0.05,
  });
  const darkConcreteMat = new THREE.MeshStandardMaterial({ color: 0x3b414c, roughness: 0.9, metalness: 0.06 });
  const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.42, metalness: 0.78 });
  const galvMat = new THREE.MeshStandardMaterial({ color: 0x8d96a4, roughness: 0.46, metalness: 0.72 });
  const timberMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: timberSoffitTex,
    roughness: 0.78,
    metalness: 0.06,
  });
  const toolboxRedMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.42, metalness: 0.35 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.92, metalness: 0.04 });

  // Semi-transparent architectural tinted blue-gray glazing showing Race Control desks & telemetry monitors inside
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a3047,
    roughness: 0.12,
    metalness: 0.24,
    clearcoat: 0.92,
    transparent: true,
    opacity: 0.56,
    envMapIntensity: 0.85,
  });
  const warmCeilingMat = new THREE.MeshStandardMaterial({
    color: 0xf4e3c1,
    emissive: 0xffd28a,
    emissiveIntensity: 0.42,
    roughness: 0.4,
  });
  const monitorMat = new THREE.MeshStandardMaterial({
    color: 0x1d354d,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.35,
    roughness: 0.28,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.34,
    roughness: 0.3,
  });
  const screenMat = new THREE.MeshStandardMaterial({
    map: timingTex,
    emissiveMap: timingTex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.34,
    roughness: 0.32,
  });
  const pitSignMat = new THREE.MeshStandardMaterial({
    map: pitHeaderTex,
    roughness: 0.48,
    metalness: 0.15,
  });

  // 1. Deep grounded foundation & pit-apron concrete terrace (34m long!)
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(13.2, 6.2, 34), concreteMat);
  plinth.position.set(0, -2.5, 0);
  plinth.receiveShadow = true;
  station.add(plinth);

  // Concrete Pit Wall barrier fronting the track side (+X faces the track)
  const pitWall = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.15, 34), concreteMat);
  pitWall.position.set(6.3, 1.15, 0);
  pitWall.castShadow = true;
  station.add(pitWall);

  // 2. Ground-Floor Pit Garages (4 recessed bays with concrete piers, red toolboxes & tire stacks)
  const garageBackWall = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.4, 30), darkConcreteMat);
  garageBackWall.position.set(-4.8, 2.8, 0);
  station.add(garageBackWall);

  const bayFloor = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.25, 30), darkConcreteMat);
  bayFloor.position.set(-0.6, 0.72, 0);
  station.add(bayFloor);

  // Dividing concrete piers creating 4 distinct open pit bays
  const pierGeo = new THREE.BoxGeometry(7.2, 4.4, 0.75);
  const tireStackGeo = new THREE.TorusGeometry(0.36, 0.14, 8, 14);
  tireStackGeo.rotateX(Math.PI / 2);

  for (let b = 0; b <= 4; b++) {
    const bz = -14.8 + b * 7.4;
    const pier = new THREE.Mesh(pierGeo, concreteMat);
    pier.position.set(-1.1, 2.8, bz);
    pier.castShadow = true;
    station.add(pier);

    if (b < 4) {
      const bayCenterZ = bz + 3.7;
      // Subtle recessed warm ceiling fluorescent bar inside each garage bay
      const bayLamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.35), warmCeilingMat);
      bayLamp.position.set(-1.2, 4.82, bayCenterZ);
      station.add(bayLamp);

      // Red mechanic rolling tool cabinet inside bay
      const toolbox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.25, 1.9), toolboxRedMat);
      toolbox.position.set(-3.4, 1.45, bayCenterZ - 1.5);
      station.add(toolbox);

      // Stacked spare racing tires on garage floor
      for (let t = 0; t < 3; t++) {
        const tire = new THREE.Mesh(tireStackGeo, tireMat);
        tire.position.set(-2.5, 0.98 + t * 0.28, bayCenterZ + 1.8);
        station.add(tire);
      }

      // Overhead pit-lane pneumatic wheel-gun gantry boom arm extending out over pit apron
      const boomMast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 8), darkSteelMat);
      boomMast.position.set(2.5, 2.5, bayCenterZ + 2.4);
      station.add(boomMast);
      const boomArm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), galvMat);
      boomArm.position.set(4.0, 4.25, bayCenterZ + 2.4);
      station.add(boomArm);
      const airHose = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 6), accentMat);
      airHose.position.set(5.1, 3.35, bayCenterZ + 2.4);
      station.add(airHose);
    }
  }

  // Pit Garage overhead fascia beam + numbered GARAGE 01–04 signage
  const mezzanineDeck = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.75, 32.2), concreteMat);
  mezzanineDeck.position.set(0.2, 5.2, 0);
  mezzanineDeck.castShadow = true;
  station.add(mezzanineDeck);

  const pitHeaderPlane = new THREE.Mesh(new THREE.PlaneGeometry(29.6, 1.15), pitSignMat);
  pitHeaderPlane.position.set(5.64, 5.2, 0);
  pitHeaderPlane.rotation.y = Math.PI / 2;
  station.add(pitHeaderPlane);

  // Exterior terrace viewing balcony safety rail (+X edge of mezzanine)
  const railPostGeo = new THREE.BoxGeometry(0.08, 1.1, 0.08);
  for (let rz = -15.2; rz <= 15.2; rz += 2.53) {
    const rPost = new THREE.Mesh(railPostGeo, galvMat);
    rPost.position.set(5.42, 6.1, rz);
    station.add(rPost);
  }
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 31.2), galvMat);
  topRail.position.set(5.42, 6.62, 0);
  station.add(topRail);
  const midRail = topRail.clone();
  midRail.position.y = 6.12;
  station.add(midRail);

  // Grounded Architectural Angled Steel Staircase with twin diagonal stringers, stepped treads & handrails
  const stairGroup = new THREE.Group();
  stairGroup.position.set(1.2, 0.7, -16.8);
  for (const sx of [-0.72, 0.72]) {
    const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 6.2), darkSteelMat);
    stringer.position.set(sx, 2.35, 1.5);
    stringer.rotation.x = -0.78;
    stairGroup.add(stringer);

    const handrail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 6.2), galvMat);
    handrail.position.set(sx, 3.35, 1.5);
    handrail.rotation.x = -0.78;
    stairGroup.add(handrail);
  }
  for (let st = 0; st < 9; st++) {
    const tread = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.14, 0.56), galvMat);
    tread.position.set(0, 0.35 + st * 0.48, -0.55 + st * 0.48);
    stairGroup.add(tread);
  }
  station.add(stairGroup);

  // 3. Second-Floor Race Control Glass Suite with visible interior control room + aluminum curtain-wall mullions
  const interiorBackWall = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.9, 21.8), darkConcreteMat);
  interiorBackWall.position.set(-4.2, 7.6, 0);
  station.add(interiorBackWall);

  // Race Control interior telemetry desk console & subtle wall display monitors
  const controlDesk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 16.5), darkSteelMat);
  controlDesk.position.set(0.2, 6.1, 0);
  station.add(controlDesk);

  for (const mz of [-5.2, 0, 5.2]) {
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 2.8), monitorMat);
    screen.position.set(-3.7, 7.8, mz);
    station.add(screen);
  }

  const suiteCeilingLamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 18.0), warmCeilingMat);
  suiteCeilingLamp.position.set(-0.8, 9.45, 0);
  station.add(suiteCeilingLamp);

  const suiteBox = new THREE.Mesh(new THREE.BoxGeometry(6.8, 4.1, 22.5), glassMat);
  suiteBox.position.set(-1.1, 7.6, 0);
  suiteBox.castShadow = true;
  station.add(suiteBox);

  // Vertical aluminum curtain-wall mullions across road-facing (+X) & south-facing (-Z) glass facades
  const mullionGeo = new THREE.BoxGeometry(0.14, 4.15, 0.14);
  for (let mz = -11.0; mz <= 11.0; mz += 2.75) {
    const mullion = new THREE.Mesh(mullionGeo, darkSteelMat);
    mullion.position.set(2.34, 7.6, mz);
    station.add(mullion);
  }
  for (let mx = -4.2; mx <= 2.3; mx += 2.15) {
    const southMullion = new THREE.Mesh(mullionGeo, darkSteelMat);
    southMullion.position.set(mx, 7.6, -11.3);
    station.add(southMullion);
  }
  // Horizontal transom bars across front and south glass facades
  const transom = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 22.6), darkSteelMat);
  transom.position.set(2.35, 8.65, 0);
  station.add(transom);
  const southTransom = new THREE.Mesh(new THREE.BoxGeometry(6.85, 0.18, 0.16), darkSteelMat);
  southTransom.position.set(-1.1, 8.65, -11.3);
  station.add(southTransom);

  // Structural architectural steel outer columns supporting the cantilevered roof canopy
  const colGeo = new THREE.BoxGeometry(0.42, 10.6, 0.42);
  for (const cz of [-14.2, -5.0, 5.0, 14.2]) {
    const colRoad = new THREE.Mesh(colGeo, darkSteelMat);
    colRoad.position.set(4.8, 5.8, cz);
    station.add(colRoad);
    const colBack = new THREE.Mesh(colGeo, darkSteelMat);
    colBack.position.set(-4.6, 5.8, cz);
    station.add(colBack);
  }

  // 4. Cantilevered Motorsport Roof Canopy with slatted timber soffit & calm accent trim
  const roof = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.65, 33.4), darkSteelMat);
  roof.position.set(0.6, 11.1, 0);
  roof.rotation.z = 0.05;
  roof.castShadow = true;
  station.add(roof);

  const soffit = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.22, 32.6), timberMat);
  soffit.position.set(0.6, 10.72, 0);
  soffit.rotation.z = 0.05;
  station.add(soffit);

  const fasciaTrim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 33.0), accentMat);
  fasciaTrim.position.set(7.15, 11.38, 0);
  station.add(fasciaTrim);

  // 5. Rooftop Engineering Details: HVAC chiller units, twin radio telemetry masts & rotating weather radar
  for (const hz of [-7.5, -4.2]) {
    const hvac = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.25, 2.2), galvMat);
    hvac.position.set(-2.2, 11.95, hz);
    station.add(hvac);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.15, 12), darkSteelMat);
    fan.position.set(-2.2, 12.62, hz);
    station.add(fan);
  }

  // Twin telemetry antenna masts
  for (const az of [8.5, 11.2]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 6.4, 8), galvMat);
    mast.position.set(-1.5, 14.4, az);
    station.add(mast);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), galvMat);
    cross.position.set(-1.5, 16.4, az);
    station.add(cross);
  }

  // Rotating Motorsport Weather & Telemetry Radar Dish
  const radarPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.48, 1.8, 10), darkSteelMat);
  radarPedestal.position.set(0.5, 12.2, 4.2);
  station.add(radarPedestal);

  const radarDish = new THREE.Group();
  radarDish.position.set(0.5, 13.4, 4.2);
  const dishBowl = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.36),
    galvMat,
  );
  dishBowl.rotation.x = Math.PI * 0.68;
  radarDish.add(dishBowl);
  const feedHorn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.1, 6), accentMat);
  feedHorn.position.set(0, 0.25, 0.62);
  feedHorn.rotation.x = Math.PI * 0.42;
  radarDish.add(feedHorn);
  station.add(radarDish);

  // 6. Unobstructed Matte LED Race Timing Leaderboard angled toward start grid
  const timingHolder = new THREE.Group();
  timingHolder.position.set(4.9, 7.8, 7.6);
  timingHolder.rotation.y = Math.PI * 0.74;

  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.1, 0.42), darkSteelMat);
  timingHolder.add(screenFrame);

  const screenFace = new THREE.Mesh(new THREE.PlaneGeometry(7.9, 3.7), screenMat);
  screenFace.position.z = 0.23;
  timingHolder.add(screenFace);

  station.add(timingHolder);

  return { group: station, radarDish };
}

// ============================================================================
// Architectural Tiered Spectator Grandstand + Mid-Lap Glass Pedestrian Bridge
// ============================================================================

function buildSpectatorGrandstand(
  track: TrackData,
  sPos: number,
  concreteTex: { albedo: THREE.CanvasTexture; bump: THREE.CanvasTexture },
  timberSoffitTex: THREE.CanvasTexture,
  sponsorTex: THREE.CanvasTexture,
  accentHex: string,
): THREE.Group {
  const sample = sampleTrackAtDistance(track, sPos);
  const halfRoad = track.course.roadWidth * 0.5 + track.course.shoulderWidth;
  const latOffset = -(halfRoad + 11.4);

  const gx = sample.pos.x + sample.right.x * latOffset;
  const gz = sample.pos.z + sample.right.z * latOffset;
  const gy = Math.min(sample.pos.y, groundHeightAt(track, gx, gz));

  const stand = new THREE.Group();
  stand.position.set(gx, gy, gz);
  stand.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteTex.albedo,
    bumpMap: concreteTex.bump,
    bumpScale: 0.2,
    roughness: 0.88,
    metalness: 0.05,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e2531, roughness: 0.44, metalness: 0.78 });
  const timberMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: timberSoffitTex,
    roughness: 0.78,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b334b,
    roughness: 0.14,
    metalness: 0.2,
    clearcoat: 0.88,
    transparent: true,
    opacity: 0.46,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.28,
    roughness: 0.34,
  });
  const sponsorMat = new THREE.MeshStandardMaterial({
    map: sponsorTex,
    roughness: 0.54,
    metalness: 0.08,
  });

  // Deep grounded cast-concrete substructure
  const base = new THREE.Mesh(new THREE.BoxGeometry(10.5, 6.0, 32.0), concreteMat);
  base.position.set(0, -2.1, 0);
  base.receiveShadow = true;
  stand.add(base);

  // 6 Ascending Concrete Seating Tiers facing the track (-X is track side from left-side placement; wait: right points +X in local frame?
  // Note: sample.right is to the right of tangent; local +X is left when rotation.y = atan2(tx, tz) because +Z aligns with tangent, so +X is -right!
  // Let's check Race Control: placed at +latOffset (+right), pitWall at +6.3 faced track. Wait: atan2(tx, tz) maps local +Z to tangent, local +X to (-tz, tx) which is LEFT of tangent (Wait: right = (-tz, tx) in our track.ts!).
  // Let's verify: in track.ts, if tangent=(0,0,1), right=(-1,0,0) or (+1,0,0)? Let's build symmetrically with front facing -X (toward track for left placement)!
  const tierCount = 6;
  const seatPalette = [0x263244, 0x334155, 0x9a3412, 0xb45309, 0x1e3a5f];
  const seatGeo = new THREE.BoxGeometry(0.46, 0.42, 0.46);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
  const totalSeats = tierCount * 36;
  const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, totalSeats);
  const dummy = new THREE.Object3D();
  const sCol = new THREE.Color();
  const rand = seededRand(9281);
  let sIdx = 0;

  for (let t = 0; t < tierCount; t++) {
    // Steps ascend AWAY from the track (+X goes deeper away from road when placed on -right side? Wait: let's keep Race Control as reference:
    // Race Control was placed at +sample.right * latOffset, and its track-facing wall was at local +X!
    // Therefore local +X points TOWARD -sample.right (LEFT), meaning for Grandstand placed at -sample.right * latOffset, local -X points TOWARD the track!
    const stepX = -4.2 + t * 1.48;
    const stepY = 1.45 + t * 0.78;
    const riser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.82, 30.8), concreteMat);
    riser.position.set(stepX, stepY, 0);
    riser.castShadow = true;
    riser.receiveShadow = true;
    stand.add(riser);

    for (let c = 0; c < 36 && sIdx < totalSeats; c++) {
      const sz = -14.2 + c * 0.81;
      dummy.position.set(stepX - 0.15, stepY + 0.62, sz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      seatMesh.setMatrixAt(sIdx, dummy.matrix);
      sCol.setHex(seatPalette[Math.floor(rand() * seatPalette.length)]);
      seatMesh.setColorAt(sIdx, sCol);
      sIdx++;
    }
  }
  seatMesh.instanceMatrix.needsUpdate = true;
  if (seatMesh.instanceColor) seatMesh.instanceColor.needsUpdate = true;
  seatMesh.computeBoundingSphere();
  stand.add(seatMesh);

  // Rear concrete wind-baffle wall
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9.2, 31.4), concreteMat);
  backWall.position.set(4.5, 5.2, 0);
  backWall.castShadow = true;
  stand.add(backWall);

  // Track-facing glass safety balustrade + sponsor fascia banner
  const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 30.8), glassMat);
  frontGlass.position.set(-5.05, 1.85, 0);
  stand.add(frontGlass);

  const fasciaBanner = new THREE.Mesh(new THREE.PlaneGeometry(24, 1.35), sponsorMat);
  fasciaBanner.position.set(-5.26, 0.82, 0);
  fasciaBanner.rotation.y = -Math.PI / 2;
  stand.add(fasciaBanner);

  // Structural rear steel columns & dramatic cantilevered architectural canopy roof with timber soffit
  for (const cz of [-14.2, -4.8, 4.8, 14.2]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.46, 10.6, 0.46), steelMat);
    col.position.set(4.1, 6.2, cz);
    stand.add(col);

    const rafter = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.42, 0.28), steelMat);
    rafter.position.set(-0.6, 10.7, cz);
    rafter.rotation.z = -0.14;
    stand.add(rafter);
  }

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.48, 32.8), steelMat);
  canopy.position.set(-0.6, 11.1, 0);
  canopy.rotation.z = -0.14;
  canopy.castShadow = true;
  stand.add(canopy);

  const soffit = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.16, 32.0), timberMat);
  soffit.position.set(-0.6, 10.8, 0);
  soffit.rotation.z = -0.14;
  stand.add(soffit);

  const edgeAccent = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 32.4), accentMat);
  edgeAccent.position.set(-6.5, 11.9, 0);
  stand.add(edgeAccent);

  return stand;
}

function buildPedestrianFootbridge(
  track: TrackData,
  sPos: number,
  concreteTex: { albedo: THREE.CanvasTexture; bump: THREE.CanvasTexture },
  bannerTex: THREE.CanvasTexture,
  accentHex: string,
): THREE.Group {
  const sample = sampleTrackAtDistance(track, sPos);
  const bridge = new THREE.Group();
  bridge.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
  bridge.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

  const halfSpan = track.course.roadWidth * 0.5 + track.course.shoulderWidth + 3.4;
  const fullSpan = halfSpan * 2;

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteTex.albedo,
    bumpMap: concreteTex.bump,
    bumpScale: 0.2,
    roughness: 0.88,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x202733, roughness: 0.42, metalness: 0.78 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x18324a,
    roughness: 0.12,
    metalness: 0.22,
    clearcoat: 0.9,
    transparent: true,
    opacity: 0.52,
  });
  const interiorGlow = new THREE.MeshStandardMaterial({
    color: 0xf4e3be,
    emissive: 0xffd185,
    emissiveIntensity: 0.36,
    roughness: 0.4,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.32,
    roughness: 0.3,
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex,
    roughness: 0.5,
  });

  // Twin board-formed concrete access towers flanking the road
  const towerGeo = new THREE.BoxGeometry(3.6, 13.5, 4.4);
  for (const side of [-1, 1]) {
    const tower = new THREE.Mesh(towerGeo, concreteMat);
    tower.position.set(side * (halfSpan + 1.2), 4.6, 0);
    tower.castShadow = true;
    bridge.add(tower);
  }

  // Elevated glazed pedestrian walkway deck
  const deck = new THREE.Mesh(new THREE.BoxGeometry(fullSpan + 2.2, 0.72, 3.6), steelMat);
  deck.position.set(0, 7.6, 0);
  deck.castShadow = true;
  bridge.add(deck);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(fullSpan + 2.6, 0.58, 4.0), steelMat);
  ceiling.position.set(0, 10.9, 0);
  bridge.add(ceiling);

  const ceilingLight = new THREE.Mesh(new THREE.BoxGeometry(fullSpan - 2.0, 0.12, 0.65), interiorGlow);
  ceilingLight.position.set(0, 10.56, 0);
  bridge.add(ceilingLight);

  // Panoramic tinted glass enclosure + vertical steel window mullions
  const glassTube = new THREE.Mesh(new THREE.BoxGeometry(fullSpan - 0.6, 2.75, 3.2), glassMat);
  glassTube.position.set(0, 9.25, 0);
  bridge.add(glassTube);

  const mullionGeo = new THREE.BoxGeometry(0.14, 2.8, 0.14);
  for (let mx = -halfSpan + 1.5; mx <= halfSpan - 1.5; mx += 3.0) {
    for (const mz of [-1.62, 1.62]) {
      const m = new THREE.Mesh(mullionGeo, steelMat);
      m.position.set(mx, 9.25, mz);
      bridge.add(m);
    }
  }

  // Subtle circuit accent rail & approach signage
  const trim = new THREE.Mesh(new THREE.BoxGeometry(fullSpan, 0.16, 3.75), accentMat);
  trim.position.set(0, 7.22, 0);
  bridge.add(trim);

  const signGeo = new THREE.PlaneGeometry(11.5, 1.35);
  const fSign = new THREE.Mesh(signGeo, bannerMat);
  fSign.position.set(0, 11.4, -1.96);
  fSign.rotation.y = Math.PI;
  bridge.add(fSign);
  const bSign = new THREE.Mesh(signGeo, bannerMat);
  bSign.position.set(0, 11.4, 1.96);
  bridge.add(bSign);

  return bridge;
}

function buildFlutteringFlagsAndMarshals(
  track: TrackData,
  flagTextures: THREE.CanvasTexture[],
  accentHex: string,
): { group: THREE.Group; flagMeshes: Array<{ mesh: THREE.Mesh; phase: number }> } {
  const group = new THREE.Group();
  const flagMeshes: Array<{ mesh: THREE.Mesh; phase: number }> = [];
  const halfRoad = track.course.roadWidth * 0.5 + track.course.shoulderWidth;

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.34, metalness: 0.82 });
  const finialMat = new THREE.MeshStandardMaterial({ color: 0xc9a14d, roughness: 0.28, metalness: 0.88 });
  const boothMat = new THREE.MeshStandardMaterial({ color: 0xd8d4ca, roughness: 0.82 });
  const darkRoofMat = new THREE.MeshStandardMaterial({ color: 0x222935, roughness: 0.48, metalness: 0.65 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.4 });

  const flagMats = flagTextures.map(
    (tex) =>
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.72,
        side: THREE.DoubleSide,
      }),
  );

  const poleGeo = new THREE.CylinderGeometry(0.065, 0.11, 8.8, 8);
  const finialGeo = new THREE.SphereGeometry(0.14, 8, 8);
  const flagGeo = new THREE.PlaneGeometry(2.5, 1.25, 6, 1);
  // Shift flag pivot cleanly to the mast edge
  flagGeo.translate(1.25, 0, 0);

  // Ceremonial flagpoles lining the Start/Finish straight & Pit plaza
  const flagDistList = [18, 28, 46, 66, 82, 94];
  let fIdx = 0;
  for (const sDist of flagDistList) {
    const s = sampleTrackAtDistance(track, sDist);
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      // Avoid crowding right inside the Pit building frontage
      if (side === 1 && sDist >= 40 && sDist <= 78) continue;
      const lat = side * (halfRoad + 3.2);
      const fx = s.pos.x + s.right.x * lat;
      const fz = s.pos.z + s.right.z * lat;
      const fy = Math.min(s.pos.y, groundHeightAt(track, fx, fz));

      const holder = new THREE.Group();
      holder.position.set(fx, fy, fz);
      holder.rotation.y = yaw + 0.55;

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4.2;
      holder.add(pole);

      const finial = new THREE.Mesh(finialGeo, finialMat);
      finial.position.y = 8.7;
      holder.add(finial);

      const banner = new THREE.Mesh(flagGeo, flagMats[fIdx % flagMats.length]);
      banner.position.set(0.06, 7.85, 0);
      holder.add(banner);
      flagMeshes.push({ mesh: banner, phase: fIdx * 0.95 });

      group.add(holder);
      fIdx++;
    }
  }

  // Corner Marshal Observation Posts at major technical corners
  let marshalCooldown = 20;
  let marshalCount = 0;
  for (let i = 30; i < track.samples.length - 15 && marshalCount < 6; i += 4) {
    if (marshalCooldown > 0) {
      marshalCooldown--;
      continue;
    }
    const s = track.samples[i];
    if (Math.abs(s.curvature) < 0.011) continue;

    const insideSign = s.curvature > 0 ? 1 : -1;
    const lat = insideSign * (halfRoad + 4.4);
    const mx = s.pos.x + s.right.x * lat;
    const mz = s.pos.z + s.right.z * lat;
    const my = Math.min(s.pos.y, groundHeightAt(track, mx, mz));

    const post = new THREE.Group();
    post.position.set(mx, my, mz);
    post.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.6), boothMat);
    deck.position.y = 0.6;
    post.add(deck);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.24, 3.0), darkRoofMat);
    canopy.position.y = 3.1;
    post.add(canopy);
    for (const [cx, cz] of [
      [-1.1, -1.1],
      [1.1, -1.1],
      [-1.1, 1.1],
      [1.1, 1.1],
    ]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), darkRoofMat);
      p.position.set(cx, 2.2, cz);
      post.add(p);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.26, 2.68), accentMat);
    stripe.position.y = 1.2;
    post.add(stripe);

    group.add(post);
    marshalCount++;
    marshalCooldown = 34;
  }

  return { group, flagMeshes };
}

// ============================================================================
// Detailed Trackside Signage: Corner Chevrons, 150/100/50m Braking Boards,
// Sponsor Hoardings, Tire-Barrier Stacks & Architectural Lamp Poles
// ============================================================================

function buildTracksideSignageAndSafety(
  track: TrackData,
  chevronTex: THREE.CanvasTexture,
  brakingTextures: [THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture],
  sponsorTextures: THREE.CanvasTexture[],
): THREE.Group {
  const group = new THREE.Group();
  const shoulderEdge = track.course.roadWidth * 0.5 + track.course.shoulderWidth;
  const outerOffset = shoulderEdge + 1.45;

  const galvMat = new THREE.MeshStandardMaterial({ color: 0x808996, roughness: 0.48, metalness: 0.74 });
  const darkBackMat = new THREE.MeshStandardMaterial({ color: 0x202632, roughness: 0.62, metalness: 0.48 });

  // Calm retroreflective chevron print (no blinding glow)
  const chevronFaceMat = new THREE.MeshStandardMaterial({
    map: chevronTex,
    emissiveMap: chevronTex,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.12,
    roughness: 0.42,
  });
  const chevronMats = [darkBackMat, darkBackMat, darkBackMat, darkBackMat, chevronFaceMat, chevronFaceMat];

  const brakingMats = brakingTextures.map((tex) => {
    const face = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.45,
      metalness: 0.08,
    });
    return [darkBackMat, darkBackMat, darkBackMat, darkBackMat, face, face];
  });

  const sponsorMats = sponsorTextures.map((tex) => {
    const face = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.55,
      metalness: 0.08,
    });
    return [darkBackMat, darkBackMat, darkBackMat, darkBackMat, face, face];
  });

  const chevronGeo = new THREE.BoxGeometry(2.6, 1.25, 0.14);
  const postGeo = new THREE.BoxGeometry(0.11, 1.75, 0.11);
  const braceGeo = new THREE.BoxGeometry(2.1, 0.08, 0.08);
  const brakeGeo = new THREE.BoxGeometry(1.75, 1.32, 0.12);
  const sponsorGeo = new THREE.BoxGeometry(7.2, 1.75, 0.16);
  const sponsorStrutGeo = new THREE.BoxGeometry(0.1, 1.7, 0.1);

  const tireStackPositions: Array<{ x: number; y: number; z: number; yaw: number; red: boolean }> = [];

  // 1. Corner Chevrons + Red/White Tire-Barrier Stacks on outside of bends + 150/100/50m Braking Boards approaching bends
  let chevronCooldown = 0;
  let brakingCooldown = 0;
  for (let i = 0; i < track.samples.length; i += 2) {
    if (chevronCooldown > 0) chevronCooldown--;
    if (brakingCooldown > 0) brakingCooldown--;

    const s = track.samples[i];
    const absCurv = Math.abs(s.curvature);
    if (absCurv < 0.0082) continue;

    const outsideSign = s.curvature > 0 ? -1 : 1;

    // Place 150m / 100m / 50m braking countdown boards on approach to major bends
    if (brakingCooldown === 0 && absCurv > 0.01) {
      const distances = [120, 80, 42];
      distances.forEach((distBack, idx) => {
        const bSample = sampleTrackAtDistance(track, s.s - distBack);
        const bx = bSample.pos.x + bSample.right.x * outsideSign * (outerOffset + 0.35);
        const bz = bSample.pos.z + bSample.right.z * outsideSign * (outerOffset + 0.35);
        const by = bSample.pos.y + Math.sin(bSample.bankAngle) * outsideSign * (outerOffset + 0.35);

        const bSign = new THREE.Group();
        bSign.position.set(bx, by, bz);
        bSign.rotation.y = Math.atan2(bSample.tangent.x, bSample.tangent.z) + Math.PI;

        for (const ox of [-0.58, 0.58]) {
          const p = new THREE.Mesh(postGeo, galvMat);
          p.position.set(ox, 0.85, 0);
          bSign.add(p);
        }
        const board = new THREE.Mesh(brakeGeo, brakingMats[idx]);
        board.position.set(0, 1.75, 0);
        bSign.add(board);
        group.add(bSign);
      });
      brakingCooldown = 28;
    }

    if (chevronCooldown === 0) {
      const x = s.pos.x + s.right.x * outsideSign * outerOffset;
      const z = s.pos.z + s.right.z * outsideSign * outerOffset;
      const y = s.pos.y + Math.sin(s.bankAngle) * outsideSign * outerOffset;
      const heading = Math.atan2(s.tangent.x, s.tangent.z);

      const sign = new THREE.Group();
      sign.position.set(x, y, z);
      sign.rotation.y = heading + (outsideSign > 0 ? -0.34 : 0.34);

      const postL = new THREE.Mesh(postGeo, galvMat);
      postL.position.set(-0.9, 0.85, 0);
      sign.add(postL);
      const postR = new THREE.Mesh(postGeo, galvMat);
      postR.position.set(0.9, 0.85, 0);
      sign.add(postR);
      const brace = new THREE.Mesh(braceGeo, galvMat);
      brace.position.set(0, 1.62, -0.09);
      sign.add(brace);

      const board = new THREE.Mesh(chevronGeo, chevronMats);
      board.position.set(0, 1.72, 0);
      sign.add(board);

      group.add(sign);

      // Add a red/white safety tire-barrier stack flush against the Armco steel guardrail
      const tireLat = shoulderEdge - 0.42;
      const tx = s.pos.x + s.right.x * outsideSign * tireLat;
      const tz = s.pos.z + s.right.z * outsideSign * tireLat;
      const ty = s.pos.y + Math.sin(s.bankAngle) * outsideSign * tireLat;
      tireStackPositions.push({ x: tx, y: ty, z: tz, yaw: heading, red: (i / 2) % 2 === 0 });

      chevronCooldown = 5;
    }
  }

  // Instanced red & white safety tire-barrier stacks (3 tires high per stack)
  if (tireStackPositions.length > 0) {
    const tireGeo = new THREE.TorusGeometry(0.42, 0.16, 8, 14);
    tireGeo.rotateX(Math.PI / 2);
    const tireBarrierMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.04 });
    const tireMesh = new THREE.InstancedMesh(tireGeo, tireBarrierMat, tireStackPositions.length * 3);
    const tDummy = new THREE.Object3D();
    const redCol = new THREE.Color(0xc22b2b);
    const whiteCol = new THREE.Color(0xdad6ce);
    let idx = 0;
    for (const sp of tireStackPositions) {
      for (let h = 0; h < 3; h++) {
        tDummy.position.set(sp.x, sp.y + 0.18 + h * 0.31, sp.z);
        tDummy.rotation.set(0, sp.yaw, 0);
        tDummy.scale.setScalar(1);
        tDummy.updateMatrix();
        tireMesh.setMatrixAt(idx, tDummy.matrix);
        tireMesh.setColorAt(idx, sp.red ? redCol : whiteCol);
        idx++;
      }
    }
    tireMesh.instanceMatrix.needsUpdate = true;
    if (tireMesh.instanceColor) tireMesh.instanceColor.needsUpdate = true;
    tireMesh.computeBoundingSphere();
    group.add(tireMesh);
  }

  // 2. Trackside Motorsport Sponsor Hoardings lining key straights (skipping start station zone)
  let sponsorIdx = 0;
  for (let i = 28; i < track.samples.length - 12; i += 22) {
    const s = track.samples[i];
    if (Math.abs(s.curvature) > 0.008) continue;
    const side = sponsorIdx % 2 === 0 ? -1 : 1;
    const lat = side * (outerOffset + 1.2);
    const sx = s.pos.x + s.right.x * lat;
    const sz = s.pos.z + s.right.z * lat;
    const sy = s.pos.y + Math.sin(s.bankAngle) * lat;

    const hoarding = new THREE.Group();
    hoarding.position.set(sx, sy, sz);
    hoarding.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);

    const panel = new THREE.Mesh(sponsorGeo, sponsorMats[sponsorIdx % sponsorMats.length]);
    panel.position.set(0, 1.05, 0);
    hoarding.add(panel);

    for (const ox of [-2.4, 0, 2.4]) {
      const strut = new THREE.Mesh(sponsorStrutGeo, galvMat);
      strut.position.set(ox, 0.85, -0.55);
      strut.rotation.x = 0.42;
      hoarding.add(strut);
    }

    group.add(hoarding);
    sponsorIdx++;
  }

  // 3. Architectural Trackside Streetlight Poles (subtle non-blinding warm luminaires)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x323946, roughness: 0.46, metalness: 0.72 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xf7e8c8,
    emissive: 0xffd594,
    emissiveIntensity: 0.48,
    roughness: 0.28,
  });
  const poleShaftGeo = new THREE.CylinderGeometry(0.08, 0.14, 7.6, 8);
  const armGeo = new THREE.BoxGeometry(0.1, 0.12, 2.1);
  const headGeo = new THREE.BoxGeometry(0.45, 0.14, 0.92);
  const lensGeo = new THREE.BoxGeometry(0.36, 0.06, 0.74);

  for (let i = 0; i < track.samples.length; i += 14) {
    const s = track.samples[i];
    const side = (i / 14) % 2 === 0 ? -1 : 1;
    // Keep right side clear in front of the Pit & Race Control station
    if (s.s > 20 && s.s < 85 && side === 1) continue;

    const lat = side * (outerOffset + 0.55);
    const lx = s.pos.x + s.right.x * lat;
    const lz = s.pos.z + s.right.z * lat;
    const ly = s.pos.y + Math.sin(s.bankAngle) * lat;

    const lamp = new THREE.Group();
    lamp.position.set(lx, ly, lz);
    // Point arm cleanly inward over the asphalt shoulder
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    lamp.rotation.y = yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2);

    const shaft = new THREE.Mesh(poleShaftGeo, poleMat);
    shaft.position.set(0, 3.8, 0);
    lamp.add(shaft);

    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.position.set(0, 7.55, 0.95);
    arm.rotation.x = -0.08;
    lamp.add(arm);

    const head = new THREE.Mesh(headGeo, poleMat);
    head.position.set(0, 7.6, 1.95);
    lamp.add(head);

    const lens = new THREE.Mesh(lensGeo, bulbMat);
    lens.position.set(0, 7.51, 1.95);
    lamp.add(lens);

    group.add(lamp);
  }

  return group;
}

// ============================================================================
// Interactive Track Features (Tamed Calm Emissives, Crisp Mechanical Detail)
// ============================================================================

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

  const rampDeckMat = new THREE.MeshStandardMaterial({
    color: 0x222936,
    roughness: 0.62,
    metalness: 0.44,
  });
  const rampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: 0xd97706,
    emissiveIntensity: 0.42,
    roughness: 0.3,
  });
  const ringOuterMat = new THREE.MeshStandardMaterial({
    color: 0x14b8a6,
    emissive: 0x0d9488,
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.55,
  });
  const ringInnerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    emissive: new THREE.Color(accentHex),
    emissiveIntensity: 0.38,
    roughness: 0.3,
  });

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

  const ringOuterGeo = new THREE.TorusGeometry(3.35, 0.18, 10, 28);
  const ringInnerGeo = new THREE.TorusGeometry(2.78, 0.08, 8, 24);
  const rampRailGeo = new THREE.BoxGeometry(0.18, 0.24, 9.2);

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

      const lipBar = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.15, 0.22), rampGlowMat);
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

// ============================================================================
// Hyper-Detailed Signature World Landmarks (All 4 Biomes)
// ============================================================================

function buildWorldLandmarks(
  track: TrackData,
  terrainBump: THREE.CanvasTexture,
): THREE.Group {
  const group = new THREE.Group();
  const style = track.course.landmarkStyle;

  if (style === 'canyon-arch') {
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x9b4829,
      bumpMap: terrainBump,
      bumpScale: 0.45,
      roughness: 0.92,
      metalness: 0.02,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0xc27747,
      bumpMap: terrainBump,
      bumpScale: 0.38,
      roughness: 0.88,
      metalness: 0.02,
    });
    const strataMat = new THREE.MeshStandardMaterial({
      color: 0xd4965b,
      roughness: 0.9,
      metalness: 0.02,
    });

    // Sculpted layered sandstone natural arches with stepped rock buttresses
    for (const archS of [118, track.totalLength * 0.52]) {
      const archSample = sampleTrackAtDistance(track, archS);
      const naturalArch = new THREE.Group();
      naturalArch.position.set(archSample.pos.x, archSample.pos.y - 2.0, archSample.pos.z);
      naturalArch.rotation.y = Math.atan2(archSample.tangent.x, archSample.tangent.z);

      const buttressGeo = new THREE.CylinderGeometry(5.6, 8.8, 12, 9);
      const pillarGeo = new THREE.CylinderGeometry(3.2, 5.4, 28, 9);

      for (const side of [-1, 1]) {
        const buttress = new THREE.Mesh(buttressGeo, rockMat);
        buttress.position.set(side * 24.0, 4.5, 0);
        naturalArch.add(buttress);

        const pillar = new THREE.Mesh(pillarGeo, rockMat);
        pillar.position.set(side * 21.8, 13.5, 0);
        pillar.rotation.z = side * 0.12;
        naturalArch.add(pillar);

        const band = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.9, 3.2, 9), strataMat);
        band.position.set(side * 22.4, 16.5, 0);
        naturalArch.add(band);
      }

      const bridgeSpan = new THREE.Mesh(new THREE.BoxGeometry(46, 5.2, 8.0), capMat);
      bridgeSpan.position.set(0, 25.2, 0);
      naturalArch.add(bridgeSpan);

      const midStrata = new THREE.Mesh(new THREE.BoxGeometry(42, 2.2, 7.4), strataMat);
      midStrata.position.set(0, 28.4, 0);
      naturalArch.add(midStrata);

      const crown = new THREE.Mesh(new THREE.BoxGeometry(34, 3.4, 6.4), rockMat);
      crown.position.set(0, 30.8, 0);
      naturalArch.add(crown);
      group.add(naturalArch);
    }

    // Multi-tiered craggy weathered Navajo sandstone mesas grounded deep into hillside slopes
    const cragCylinder = (rTop: number, rBot: number, height: number, seed: number) => {
      const g = new THREE.CylinderGeometry(rTop, rBot, height, 14, 4);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const ang = Math.atan2(vz, vx);
        const crag = 0.88 + 0.16 * Math.sin(ang * 5 + seed) + 0.08 * Math.cos(ang * 9 + vy * 0.14);
        pos.setXYZ(i, vx * crag, vy, vz * crag);
      }
      g.computeVertexNormals();
      return g;
    };

    const mesaSpecs = COURSE_LANDMARKS[track.course.id].mesas ?? [];
    mesaSpecs.forEach((m, idx) => {
      if (computeLandmarkTrackClearance(track, m.x, m.z, m.radius * 1.45) < 4) return;
      const gy = groundHeightAt(track, m.x, m.z);
      const mesa = new THREE.Group();
      mesa.position.set(m.x, gy - 4, m.z);

      const talus = new THREE.Mesh(
        cragCylinder(m.radius * 0.85, m.radius * 1.32, m.height * 0.45 + 22, idx * 3 + 1),
        rockMat,
      );
      talus.position.y = m.height * 0.22 - 10;
      mesa.add(talus);

      const cliff = new THREE.Mesh(
        cragCylinder(m.radius * 0.68, m.radius * 0.82, m.height * 0.34, idx * 3 + 2),
        capMat,
      );
      cliff.position.y = m.height * 0.54;
      mesa.add(cliff);

      const band = new THREE.Mesh(
        cragCylinder(m.radius * 0.63, m.radius * 0.69, m.height * 0.14, idx * 3 + 3),
        strataMat,
      );
      band.position.y = m.height * 0.76;
      mesa.add(band);

      const cap = new THREE.Mesh(
        cragCylinder(m.radius * 0.54, m.radius * 0.62, m.height * 0.18, idx * 3 + 4),
        rockMat,
      );
      cap.position.y = m.height * 0.90;
      mesa.add(cap);
      group.add(mesa);
    });
  } else if (style === 'limestone-viaduct') {
    const limeMat = new THREE.MeshStandardMaterial({
      color: 0xd8d0bf,
      bumpMap: terrainBump,
      bumpScale: 0.22,
      roughness: 0.84,
      metalness: 0.04,
    });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9b9281, roughness: 0.9 });
    const terraMat = new THREE.MeshStandardMaterial({ color: 0xae563a, roughness: 0.8 });
    const shutterMat = new THREE.MeshStandardMaterial({ color: 0x265470, roughness: 0.72 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1e2530, roughness: 0.45, metalness: 0.75 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x1e354d,
      emissive: 0xf4c97a,
      emissiveIntensity: 0.16,
      roughness: 0.25,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0xf5e5bc,
      emissive: 0xffcf75,
      emissiveIntensity: 0.58,
      roughness: 0.24,
    });

    // Detailed Mediterranean Headland Lighthouse with iron gallery rail & keeper's cottage
    const lhSpec = COURSE_LANDMARKS[track.course.id].lighthouse;
    if (lhSpec && computeLandmarkTrackClearance(track, lhSpec.x, lhSpec.z, lhSpec.radius) >= 4) {
      const lhY = Math.max(-2, groundHeightAt(track, lhSpec.x, lhSpec.z));
      const lighthouse = new THREE.Group();
      lighthouse.position.set(lhSpec.x, lhY - 4, lhSpec.z);

      const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 7.0, 8, 12), stoneMat);
      lhBase.position.y = 2;
      lighthouse.add(lhBase);

      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 4.8, 42, 16), limeMat);
      tower.position.y = 22;
      lighthouse.add(tower);

      // Painted crimson maritime daymark band
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.65, 7.2, 16), terraMat);
      stripe.position.y = 28;
      lighthouse.add(stripe);

      const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.3, 1.5, 16), stoneMat);
      gallery.position.y = 43.2;
      lighthouse.add(gallery);

      const railRing = new THREE.Mesh(new THREE.TorusGeometry(3.75, 0.1, 6, 16), ironMat);
      railRing.rotation.x = Math.PI / 2;
      railRing.position.y = 44.8;
      lighthouse.add(railRing);

      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 4.2, 12), lanternMat);
      lantern.position.y = 46;
      lighthouse.add(lantern);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 4.0, 14), terraMat);
      roof.position.y = 49.8;
      lighthouse.add(roof);

      // Attached stone keeper's cottage
      const cottage = new THREE.Mesh(new THREE.BoxGeometry(9.5, 6.2, 7.4), limeMat);
      cottage.position.set(7.5, 4.5, 0);
      lighthouse.add(cottage);
      const cottageRoof = new THREE.Mesh(new THREE.ConeGeometry(7.0, 2.8, 4), terraMat);
      cottageRoof.position.set(7.5, 9.0, 0);
      cottageRoof.rotation.y = Math.PI / 4;
      lighthouse.add(cottageRoof);
      group.add(lighthouse);
    }

    // Multi-part Mediterranean hillside villas with stone retaining walls, shutters & chimneys
    const villaSpecs = COURSE_LANDMARKS[track.course.id].villas ?? [];
    for (const v of villaSpecs) {
      if (computeLandmarkTrackClearance(track, v.x, v.z, v.radius) < 4) continue;
      const vy = groundHeightAt(track, v.x, v.z);
      if (track.course.waterLevel !== null && vy < track.course.waterLevel + 3) continue;
      const villa = new THREE.Group();
      villa.position.set(v.x, vy - 2.8, v.z);
      villa.rotation.y = v.rotY;

      const terrace = new THREE.Mesh(new THREE.BoxGeometry(14.5, 4.5, 12), stoneMat);
      terrace.position.y = 1.2;
      villa.add(terrace);

      const walls = new THREE.Mesh(new THREE.BoxGeometry(11, 8.2, 8.4), limeMat);
      walls.position.y = 6.5;
      villa.add(walls);

      const wing = new THREE.Mesh(new THREE.BoxGeometry(5.5, 5.4, 6.0), limeMat);
      wing.position.set(-6.5, 5.2, 1.0);
      villa.add(wing);

      const pitchedRoof = new THREE.Mesh(new THREE.ConeGeometry(8.2, 3.4, 4), terraMat);
      pitchedRoof.position.y = 12.2;
      pitchedRoof.rotation.y = Math.PI / 4;
      villa.add(pitchedRoof);

      const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.8, 1.1), limeMat);
      chimney.position.set(2.4, 12.5, -1.2);
      villa.add(chimney);

      for (const wx of [-2.8, 0, 2.8]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 8.6), windowMat);
        win.position.set(wx, 7.6, 0);
        villa.add(win);
        const shut = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.0, 8.5), shutterMat);
        shut.position.set(wx, 7.6, 0);
        villa.add(shut);
      }

      group.add(villa);
    }

    // Rigged Mediterranean Sailboats (sculpted hulls, cabin tops, booms, mainsail & jib)
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.45, metalness: 0.1 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x8d6342, roughness: 0.72 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xefede7, roughness: 0.7, side: THREE.DoubleSide });
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x454e5e, roughness: 0.48, metalness: 0.65 });
    const boatRand = seededRand(6183);
    if (track.course.waterLevel !== null) {
      const wY = track.course.waterLevel + 0.15;
      for (let b = 0; b < 16; b++) {
        const bx = -140 - boatRand() * 340;
        const bz = -360 + boatRand() * 720;
        const gy = groundHeightAt(track, bx, bz);
        if (gy > wY - 1.2) continue;
        const boat = new THREE.Group();
        boat.position.set(bx, wY, bz);
        boat.rotation.y = boatRand() * Math.PI * 2;

        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.95, 7.4), hullMat);
        hull.position.y = 0.35;
        boat.add(hull);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.65, 2.8), deckMat);
        cabin.position.set(0, 1.0, -0.4);
        boat.add(cabin);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 8.8, 8), mastMat);
        mast.position.set(0, 4.7, 0.4);
        boat.add(mast);
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), mastMat);
        boom.rotation.x = Math.PI / 2;
        boom.position.set(0, 2.0, -1.4);
        boat.add(boom);

        const mainSailGeo = new THREE.ConeGeometry(2.6, 7.2, 3);
        mainSailGeo.scale(0.12, 1, 1);
        const mainSail = new THREE.Mesh(mainSailGeo, sailMat);
        mainSail.position.set(0, 5.2, -1.1);
        boat.add(mainSail);

        const jibGeo = new THREE.ConeGeometry(1.6, 5.6, 3);
        jibGeo.scale(0.1, 1, 1);
        const jib = new THREE.Mesh(jibGeo, sailMat);
        jib.position.set(0, 4.4, 1.8);
        boat.add(jib);

        group.add(boat);
      }
    }

    // Coastal limestone viaduct colonnade with capital cornices
    for (let i = 0; i < 10; i++) {
      const s = 72 + i * 32;
      const sample = sampleTrackAtDistance(track, s);
      const px = sample.pos.x - sample.right.x * 24;
      const pz = sample.pos.z - sample.right.z * 24;
      const py = groundHeightAt(track, px, pz);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.85, 22, 10), limeMat);
      col.position.set(px, py + 7, pz);
      group.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.0, 3.8), stoneMat);
      cap.position.set(px, py + 18.2, pz);
      group.add(cap);
    }
  } else if (style === 'sakura-torii') {
    const vermilionMat = new THREE.MeshStandardMaterial({ color: 0xb82424, roughness: 0.48, metalness: 0.1 });
    const darkCapMat = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.58, metalness: 0.22 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xc8a048, roughness: 0.3, metalness: 0.82 });
    const lanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xf4dfb8,
      emissive: 0xffa64d,
      emissiveIntensity: 0.52,
      roughness: 0.4,
    });
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x676f7c,
      bumpMap: terrainBump,
      bumpScale: 0.3,
      roughness: 0.9,
    });
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d5, roughness: 0.84 });

    // Ornate curved-eave Vermilion Torii Portals with stone footings, gakuzuka plaque & carved Toro lanterns
    const toriiFractions = [0.09, 0.34, 0.63, 0.88];
    const halfSpan = track.course.roadWidth * 0.5 + track.course.shoulderWidth + 1.85;

    for (const frac of toriiFractions) {
      const sample = sampleTrackAtDistance(track, track.totalLength * frac);
      const torii = new THREE.Group();
      torii.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
      torii.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);

      const postGeo = new THREE.CylinderGeometry(0.62, 0.84, 13.6, 12);
      const footGeo = new THREE.CylinderGeometry(1.05, 1.25, 2.2, 10);
      for (const side of [-1, 1]) {
        const foot = new THREE.Mesh(footGeo, darkCapMat);
        foot.position.set(side * halfSpan, 1.0, 0);
        torii.add(foot);

        const post = new THREE.Mesh(postGeo, vermilionMat);
        post.position.set(side * halfSpan, 6.8, 0);
        torii.add(post);
      }

      const nuki = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 4.8, 0.88, 0.85), vermilionMat);
      nuki.position.set(0, 10.6, 0);
      torii.add(nuki);

      // Central gilded shrine tablet (gakuzuka) connecting nuki to kasagi
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 0.65), darkCapMat);
      plaque.position.set(0, 11.8, 0);
      torii.add(plaque);
      const plaqueRim = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.72), goldMat);
      plaqueRim.position.set(0, 11.8, 0);
      torii.add(plaqueRim);

      const shimaki = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 6.8, 0.9, 1.2), vermilionMat);
      shimaki.position.set(0, 12.9, 0);
      torii.add(shimaki);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 8.0, 0.6, 1.65), darkCapMat);
      cap.position.set(0, 13.65, 0);
      torii.add(cap);

      // Upturned end-tips of the kasagi roof beam
      for (const side of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.62, 1.65), darkCapMat);
        tip.position.set(side * (halfSpan + 4.8), 14.0, 0);
        tip.rotation.z = side * 0.24;
        torii.add(tip);

        // Carved stone Toro lanterns flanking the gateway
        const lx = side * (halfSpan + 2.3);
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.3), stoneMat);
        plinth.position.set(lx, 0.3, -1.6);
        torii.add(plinth);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 1.8, 8), stoneMat);
        shaft.position.set(lx, 1.4, -1.6);
        torii.add(shaft);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.9, 0.82), lanternGlowMat);
        lamp.position.set(lx, 2.68, -1.6);
        torii.add(lamp);
        const hood = new THREE.Mesh(new THREE.ConeGeometry(1.18, 0.85, 4), stoneMat);
        hood.position.set(lx, 3.55, -1.6);
        hood.rotation.y = Math.PI / 4;
        torii.add(hood);
      }

      group.add(torii);
    }

    // Ornate 3-Tier Mountain Pagoda with stone terrace, timber veranda railings & gold sorin finial
    const pagSpec = COURSE_LANDMARKS[track.course.id].pagoda;
    if (pagSpec && computeLandmarkTrackClearance(track, pagSpec.x, pagSpec.z, pagSpec.radius) >= 4) {
      const pagY = groundHeightAt(track, pagSpec.x, pagSpec.z);
      const pagoda = new THREE.Group();
      pagoda.position.set(pagSpec.x, pagY - 3, pagSpec.z);

      const pBase = new THREE.Mesh(new THREE.BoxGeometry(14.5, 8.5, 14.5), stoneMat);
      pBase.position.y = 1.0;
      pagoda.add(pBase);

      for (let tier = 0; tier < 3; tier++) {
        const scale = 1 - tier * 0.2;
        const ty = 7.4 + tier * 6.2;
        const story = new THREE.Mesh(
          new THREE.BoxGeometry(9.2 * scale, 4.4, 9.2 * scale),
          tier % 2 === 0 ? vermilionMat : plasterMat,
        );
        story.position.y = ty;
        pagoda.add(story);

        const veranda = new THREE.Mesh(new THREE.BoxGeometry(10.8 * scale, 0.45, 10.8 * scale), darkCapMat);
        veranda.position.y = ty - 2.0;
        pagoda.add(veranda);

        const eave = new THREE.Mesh(new THREE.ConeGeometry(9.8 * scale, 2.7, 4), darkCapMat);
        eave.position.y = ty + 3.2;
        eave.rotation.y = Math.PI / 4;
        pagoda.add(eave);
      }
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.34, 6.8, 10), goldMat);
      spire.position.y = 26.8;
      pagoda.add(spire);
      group.add(pagoda);
    }

    // Sculpted volcanic Mount Solstice peak on the northern horizon (well clear of the circuit!)
    const mtSpec = COURSE_LANDMARKS[track.course.id].mountain;
    if (mtSpec && computeLandmarkTrackClearance(track, mtSpec.x, mtSpec.z, mtSpec.baseRadius) >= 8) {
      const mountain = new THREE.Group();
      mountain.position.set(mtSpec.x, -14, mtSpec.z);
      const slopeMat = new THREE.MeshStandardMaterial({
        color: 0x364258,
        bumpMap: terrainBump,
        bumpScale: 0.6,
        roughness: 0.92,
      });
      const snowMat = new THREE.MeshStandardMaterial({ color: 0xdce4ee, roughness: 0.78 });
      const mBase = new THREE.Mesh(
        new THREE.ConeGeometry(mtSpec.baseRadius, mtSpec.baseHeight, 22),
        slopeMat,
      );
      mBase.position.y = mtSpec.baseHeight * 0.49;
      mountain.add(mBase);
      const mSpur = new THREE.Mesh(
        new THREE.ConeGeometry(mtSpec.spurRadius, mtSpec.spurHeight, 16),
        slopeMat,
      );
      mSpur.position.set(mtSpec.spurOffsetX, mtSpec.spurHeight * 0.45, mtSpec.spurOffsetZ);
      mountain.add(mSpur);
      const mSnow = new THREE.Mesh(
        new THREE.ConeGeometry(mtSpec.snowRadius, mtSpec.snowHeight, 22),
        snowMat,
      );
      mSnow.position.y = mtSpec.baseHeight * 0.8;
      mountain.add(mSnow);
      group.add(mountain);
    }
  } else {
    // Glacier Observatory: Paneled brushed-aluminum astronomical domes + telemetry dishes + crystalline ice crags
    const domeWhite = new THREE.MeshStandardMaterial({ color: 0xc5d0dc, roughness: 0.38, metalness: 0.52 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc29542, roughness: 0.28, metalness: 0.85 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x222b38, roughness: 0.45, metalness: 0.75 });
    const slitGlow = new THREE.MeshStandardMaterial({
      color: 0x5ab4e6,
      emissive: 0x2688c4,
      emissiveIntensity: 0.48,
      roughness: 0.3,
    });
    const iceSpireMat = new THREE.MeshPhysicalMaterial({
      color: 0x7ebde0,
      roughness: 0.22,
      metalness: 0.14,
      clearcoat: 0.75,
      envMapIntensity: 0.75,
    });

    const domeSpecs = COURSE_LANDMARKS[track.course.id].domes ?? [];
    for (const d of domeSpecs) {
      if (computeLandmarkTrackClearance(track, d.x, d.z, d.radius * 1.25) < 4) continue;
      const radius = d.radius;
      const gy = groundHeightAt(track, d.x, d.z);
      const obs = new THREE.Group();
      obs.position.set(d.x, gy - 2, d.z);

      const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.15, radius * 0.9 + 14, 20), domeWhite);
      drum.position.y = radius * 0.45 - 7;
      obs.add(drum);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, 0.52, 8, 28), brassMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = radius * 0.92;
      obs.add(ring);

      const catwalk = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.12, 0.24, 6, 24), darkSteel);
      catwalk.rotation.x = Math.PI / 2;
      catwalk.position.y = radius * 0.82;
      obs.add(catwalk);

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
        domeWhite,
      );
      dome.position.y = radius * 0.9;
      obs.add(dome);

      const slitFrame = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.3, radius * 0.9, radius * 1.12), darkSteel);
      slitFrame.position.set(0, radius * 1.32, radius * 0.12);
      obs.add(slitFrame);

      const slit = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.2, radius * 0.8, radius * 1.16), slitGlow);
      slit.position.set(0, radius * 1.32, radius * 0.13);
      obs.add(slit);

      group.add(obs);
    }

    const spireSpecs = COURSE_LANDMARKS[track.course.id].spires ?? [];
    for (const sp of spireSpecs) {
      if (computeLandmarkTrackClearance(track, sp.x, sp.z, sp.radius * 1.5) < 4) continue;
      const gy = groundHeightAt(track, sp.x, sp.z);
      const cluster = new THREE.Group();
      cluster.position.set(sp.x, gy - 4, sp.z);
      const main = new THREE.Mesh(new THREE.ConeGeometry(sp.radius, sp.height, 6), iceSpireMat);
      main.position.y = sp.height * 0.42;
      main.rotation.set(0.08, sp.x * 0.1, -0.06);
      cluster.add(main);
      const sub = new THREE.Mesh(new THREE.ConeGeometry(sp.radius * 0.62, sp.height * 0.68, 5), iceSpireMat);
      sub.position.set(sp.radius * 0.65, sp.height * 0.26, sp.radius * 0.3);
      sub.rotation.set(-0.1, sp.x * 0.2, 0.14);
      cluster.add(sub);
      group.add(cluster);
    }
  }

  return group;
}

// ============================================================================
// Multi-Part Botanical Trees (Textured Bark + Branches + 3 Layered Foliage Tiers)
// ============================================================================

function createOrganicFoliageGeometry(radius: number, heightScale: number, seed: number): THREE.BufferGeometry {
  // Smooth subdivision-2 organic bough silhouette (eliminates low-poly faceted crystal triangles)
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const wobble =
      0.88 +
      0.16 * Math.sin(x * 1.9 + z * 1.5 + seed) * Math.cos(y * 1.6) +
      0.08 * Math.cos(x * 3.4 - z * 2.8 + seed * 1.7);
    pos.setXYZ(i, x * wobble, y * heightScale * wobble, z * wobble);
  }
  geo.computeVertexNormals();
  return geo;
}

function createParticlePool(capacity = 220): ParticlePool {
  const geo = new THREE.IcosahedronGeometry(0.42, 0);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.68,
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

function createSkidmarkPool(capacity = 360): SkidmarkPool {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    color: 0x0b0d12,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const clear = () => {
    for (let i = 0; i < capacity; i++) {
      dummy.position.set(0, -999, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.001);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  clear();

  let cursor = 0;
  const stamp = (
    x: number,
    y: number,
    z: number,
    heading: number,
    bankAngle: number,
    length: number,
    width: number,
  ) => {
    dummy.position.set(x, y + 0.045, z);
    dummy.rotation.order = 'YXZ';
    dummy.rotation.set(0, heading, -bankAngle);
    dummy.scale.set(width, 1, length);
    dummy.updateMatrix();
    mesh.setMatrixAt(cursor, dummy.matrix);
    cursor = (cursor + 1) % capacity;
    mesh.instanceMatrix.needsUpdate = true;
  };

  const dispose = () => {
    geo.dispose();
    mat.dispose();
  };

  return { mesh, stamp, clear, dispose };
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
  const terrainTex = createTerrainDetailTextures(maxAnisotropy);
  const foliageTex = createFoliageTextures(maxAnisotropy);
  const concreteTex = createConcreteFormworkTexture(maxAnisotropy);
  const timberSoffitTex = createTimberSoffitTexture(maxAnisotropy);
  const chevronTex = createChevronSignTexture(course.accentHex, maxAnisotropy);
  const timingTex = createTimingTowerTexture(course.name, course.accentHex, maxAnisotropy);
  const pitHeaderTex = createPitBayHeaderTexture(course.accentHex, maxAnisotropy);
  const brakingTextures: [THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture] = [
    createBrakingSignTexture(150, maxAnisotropy),
    createBrakingSignTexture(100, maxAnisotropy),
    createBrakingSignTexture(50, maxAnisotropy),
  ];
  const sponsorTextures = [0, 1, 2, 3].map((v) =>
    createSponsorBoardTexture(v, course.accentHex, maxAnisotropy),
  );
  const flagTextures = [0, 1, 2].map((v) =>
    createPennantFlagTexture(course.accentHex, v, maxAnisotropy),
  );
  const delineatorTex = createDelineatorPostTexture(maxAnisotropy);

  ownedTextures.push(
    roadTex.albedo,
    roadTex.bump,
    roadTex.roughness,
    roadTex.curb,
    roadTex.startGrid,
    roadTex.gravel,
    terrainTex.albedo,
    terrainTex.bump,
    foliageTex.barkAlbedo,
    foliageTex.barkBump,
    foliageTex.leafAlbedo,
    concreteTex.albedo,
    concreteTex.bump,
    timberSoffitTex,
    chevronTex,
    timingTex,
    pitHeaderTex,
    ...brakingTextures,
    ...sponsorTextures,
    ...flagTextures,
    delineatorTex,
  );

  // 1. Procedural Atmospheric Sky Dome
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
    uStarStrength: { value: course.hasAurora ? 0.75 : 0.0 },
  };
  const skyGeo = new THREE.SphereGeometry(980, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));

  // 2. Sculpted Slope-Aware Mountain Terrain
  const terrain = createTerrainMesh(track, terrainTex.albedo, terrainTex.bump);
  group.add(terrain);

  // 2b. Animated Turquoise Ocean Lagoon (Sunken Glass Coast)
  let waterUniforms: {
    uTime: { value: number };
    uShallowColor: { value: THREE.Color };
    uDeepColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
  } | null = null;

  if (course.waterLevel !== null) {
    waterUniforms = {
      uTime: { value: 0 },
      uShallowColor: { value: new THREE.Color(course.waterColor) },
      uDeepColor: { value: new THREE.Color(course.waterDeepColor) },
      uHorizonColor: { value: new THREE.Color(course.skyHorizon) },
      uSunColor: { value: new THREE.Color(course.sunColor) },
      uSunDir: { value: skyUniforms.uSunDir.value.clone() },
    };
    const waterGeo = new THREE.PlaneGeometry(1500, 1500, 56, 56);
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

  // 3. Glare-Free Weathered Asphalt, Beveled Curbs, Raked Gravel Shoulders & Double-Rail Armco Guardrails
  const halfRoad = course.roadWidth * 0.5;
  const shoulderOuter = halfRoad + course.shoulderWidth;

  const asphaltGeo = createTrackRibbonGeometry(track, -halfRoad, halfRoad, 0.02, 16);
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTex.albedo,
    bumpMap: roadTex.bump,
    bumpScale: 0.085,
    roughness: 0.94,
    roughnessMap: roadTex.roughness,
    metalness: 0.04,
  });
  const asphaltMesh = new THREE.Mesh(asphaltGeo, asphaltMat);
  asphaltMesh.receiveShadow = true;
  group.add(asphaltMesh);

  const curbWidth = 1.15;
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roadTex.curb,
    roughness: 0.84,
    metalness: 0.04,
  });
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, -halfRoad - curbWidth, -halfRoad + 0.04, 0.045, 5), curbMat));
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, halfRoad - 0.04, halfRoad + curbWidth, 0.045, 5), curbMat));

  // Raked gravel runoff trap shoulders tinted subtly to biome
  const shoulderMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(course.terrainMid).lerp(new THREE.Color(0xcbc4b8), 0.35),
    map: roadTex.gravel,
    roughness: 0.96,
    metalness: 0.02,
  });
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, -shoulderOuter - 0.8, -halfRoad - curbWidth + 0.05, -0.02, 6), shoulderMat));
  group.add(new THREE.Mesh(createTrackRibbonGeometry(track, halfRoad + curbWidth - 0.05, shoulderOuter + 0.8, -0.02, 6), shoulderMat));

  // Double-wave galvanized Armco W-Beam steel guardrail (upper & lower corrugated rails)
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x9fa8b3,
    roughness: 0.44,
    metalness: 0.68,
    side: THREE.DoubleSide,
  });
  const railShadowMat = new THREE.MeshStandardMaterial({
    color: 0x67707c,
    roughness: 0.55,
    metalness: 0.62,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const lat = side * shoulderOuter;
    group.add(new THREE.Mesh(createGuardrailBandGeometry(track, lat, 0.52, 0.9), railMat));
    group.add(new THREE.Mesh(createGuardrailBandGeometry(track, lat, 0.14, 0.46), railShadowMat));
  }

  // Bolted steel I-beam stanchions + subtle cat's-eye reflectors along both Armco guardrails
  const stanchionStep = 2;
  const stanchionCount = Math.floor(track.samples.length / stanchionStep) * 2;
  const stanchionGeo = new THREE.BoxGeometry(0.14, 1.05, 0.14);
  stanchionGeo.translate(0, 0.45, 0);
  const stanchionMat = new THREE.MeshStandardMaterial({ color: 0x353e4c, roughness: 0.55, metalness: 0.74 });
  const stanchions = new THREE.InstancedMesh(stanchionGeo, stanchionMat, stanchionCount);
  const sDummy = new THREE.Object3D();
  let stIdx = 0;
  for (let i = 0; i < track.samples.length && stIdx < stanchionCount - 1; i += stanchionStep) {
    const s = track.samples[i];
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    for (const side of [-1, 1]) {
      const lat = side * (shoulderOuter + 0.08);
      sDummy.position.set(
        s.pos.x + s.right.x * lat,
        s.pos.y + Math.sin(s.bankAngle) * lat - 0.05,
        s.pos.z + s.right.z * lat,
      );
      sDummy.rotation.set(0, yaw, 0);
      sDummy.scale.setScalar(1);
      sDummy.updateMatrix();
      stanchions.setMatrixAt(stIdx++, sDummy.matrix);
    }
  }
  stanchions.instanceMatrix.needsUpdate = true;
  stanchions.computeBoundingSphere();
  group.add(stanchions);

  // 4. Trussed Start/Finish Gantry + Pit & Race Control Station + Tiered Grandstand + Pedestrian Bridge + Flags
  const bannerTex = createStartBannerTexture(course.name, course.accentHex, maxAnisotropy);
  ownedTextures.push(bannerTex);
  group.add(buildStartingGantry(track, 36, bannerTex, roadTex.startGrid, concreteTex, course.accentHex));

  const stationBuild = buildRaceControlStation(
    track,
    58,
    timingTex,
    pitHeaderTex,
    concreteTex,
    timberSoffitTex,
    course.accentHex,
  );
  group.add(stationBuild.group);

  group.add(
    buildSpectatorGrandstand(
      track,
      54,
      concreteTex,
      timberSoffitTex,
      sponsorTextures[0],
      course.accentHex,
    ),
  );

  group.add(
    buildPedestrianFootbridge(
      track,
      track.totalLength * 0.42,
      concreteTex,
      bannerTex,
      course.accentHex,
    ),
  );

  const flagsBuild = buildFlutteringFlagsAndMarshals(track, flagTextures, course.accentHex);
  group.add(flagsBuild.group);

  group.add(buildTracksideSignageAndSafety(track, chevronTex, brakingTextures, sponsorTextures));

  for (let c = 1; c < track.checkpointCount; c++) {
    group.add(buildCheckpointArch(track, track.checkpointDistances[c], course.accentHex));
  }

  // 5. Interactive Track Features
  const featureBuild = buildInteractiveFeatures(track, course.accentHex);
  group.add(featureBuild.group);

  // 6. Signature World Landmarks
  group.add(buildWorldLandmarks(track, terrainTex.bump));

  // 7. Hyper-Detailed 6-Part Botanical Trees (Dual Branches + 4 Layered Foliage Boughs) + Shrubs + Boulders
  const rand = seededRand(course.id.length * 733 + 31);
  const treePositions: Array<{ x: number; y: number; z: number; scale: number; rotY: number; leanX: number; leanZ: number }> = [];
  const bushPositions: Array<{ x: number; y: number; z: number; scale: number; rotY: number }> = [];
  const rockPositions: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; rotY: number }> = [];

  for (let i = 0; i < track.samples.length; i += 3) {
    const s = track.samples[i];
    for (const side of [-1, 1]) {
      // Keep the Pit & Race Control station (right) and Spectator Grandstand (left) footprints clear of trees
      if (s.s > 28 && s.s < 88) continue;

      const dist = shoulderOuter + 7 + rand() * 44;
      const x = s.pos.x + s.right.x * side * dist;
      const z = s.pos.z + s.right.z * side * dist;
      const y = groundHeightAt(track, x, z);
      if (course.waterLevel !== null && y < course.waterLevel + 2.2) continue;

      const roll = rand();
      if (roll < 0.62) {
        treePositions.push({
          x,
          y,
          z,
          scale: 0.85 + rand() * 0.5,
          rotY: rand() * Math.PI * 2,
          leanX: (rand() - 0.5) * 0.08,
          leanZ: (rand() - 0.5) * 0.08,
        });
      } else if (roll < 0.84) {
        bushPositions.push({
          x,
          y,
          z,
          scale: 0.7 + rand() * 0.65,
          rotY: rand() * Math.PI * 2,
        });
      } else {
        rockPositions.push({
          x,
          y: y - 0.4,
          z,
          sx: 1.6 + rand() * 3.4,
          sy: 1.0 + rand() * 2.8,
          sz: 1.6 + rand() * 3.2,
          rotY: rand() * Math.PI * 2,
        });
      }
    }
  }

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();

  if (treePositions.length > 0) {
    const isSakura = course.treeStyle === 'sakura';
    const isCypress = course.treeStyle === 'cypress';
    const isPine = course.treeStyle === 'pine';

    const barkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: foliageTex.barkAlbedo,
      bumpMap: foliageTex.barkBump,
      bumpScale: 0.28,
      roughness: 0.94,
    });

    // Tapered trunk with deep root extension (never floats on steep hillsides) + angled side bough limbs
    const trunkH = isCypress ? 3.8 : isPine ? 4.4 : 4.0;
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.46, trunkH, 8);
    trunkGeo.translate(0, trunkH * 0.5 - 0.75, 0);

    const branchGeo = new THREE.CylinderGeometry(0.08, 0.16, 2.2, 6);
    branchGeo.translate(0, 1.0, 0);
    branchGeo.rotateZ(0.62);
    branchGeo.translate(0.1, trunkH * 0.62, 0);

    const branch2Geo = new THREE.CylinderGeometry(0.07, 0.14, 1.9, 6);
    branch2Geo.translate(0, 0.9, 0);
    branch2Geo.rotateZ(-0.56);
    branch2Geo.rotateY(1.2);
    branch2Geo.translate(-0.12, trunkH * 0.54, 0.08);

    // 4 staggered asymmetrical botanical foliage boughs per tree
    let crown1Geo: THREE.BufferGeometry;
    let crown2Geo: THREE.BufferGeometry;
    let crown3Geo: THREE.BufferGeometry;
    let crown4Geo: THREE.BufferGeometry;

    if (isPine) {
      // Multi-tiered jagged evergreen alpine spruce boughs (4 overlapping irregular tiers)
      crown1Geo = new THREE.ConeGeometry(2.85, 3.6, 9);
      crown1Geo.translate(0, 3.6, 0);
      crown2Geo = new THREE.ConeGeometry(2.3, 3.3, 9);
      crown2Geo.translate(0.15, 5.4, -0.1);
      crown3Geo = new THREE.ConeGeometry(1.65, 2.9, 9);
      crown3Geo.translate(-0.12, 7.0, 0.1);
      crown4Geo = new THREE.ConeGeometry(1.05, 2.3, 9);
      crown4Geo.translate(0.06, 8.4, -0.05);
    } else if (isCypress) {
      // Sculpted tall Mediterranean Tuscan cypress clusters
      crown1Geo = createOrganicFoliageGeometry(1.48, 2.1, 101);
      crown1Geo.translate(0, 4.3, 0);
      crown2Geo = createOrganicFoliageGeometry(1.18, 1.9, 202);
      crown2Geo.translate(0.2, 6.6, -0.15);
      crown3Geo = createOrganicFoliageGeometry(0.84, 1.7, 303);
      crown3Geo.translate(-0.14, 8.4, 0.12);
      crown4Geo = createOrganicFoliageGeometry(0.52, 1.5, 355);
      crown4Geo.translate(0.08, 9.8, -0.04);
    } else if (isSakura) {
      // Wide spreading Japanese cherry blossom bough clouds
      crown1Geo = createOrganicFoliageGeometry(2.55, 0.68, 404);
      crown1Geo.translate(-0.95, 4.2, 0.5);
      crown2Geo = createOrganicFoliageGeometry(2.25, 0.65, 505);
      crown2Geo.translate(1.3, 4.7, -0.55);
      crown3Geo = createOrganicFoliageGeometry(1.9, 0.62, 606);
      crown3Geo.translate(0.15, 5.75, 0.15);
      crown4Geo = createOrganicFoliageGeometry(1.6, 0.58, 656);
      crown4Geo.translate(-0.45, 5.0, -1.15);
    } else {
      // Gnarled high-desert canyon juniper / cedar multi-cluster crown
      crown1Geo = createOrganicFoliageGeometry(2.15, 0.72, 707);
      crown1Geo.translate(-0.78, 3.55, 0.35);
      crown2Geo = createOrganicFoliageGeometry(1.8, 0.68, 808);
      crown2Geo.translate(1.1, 4.1, -0.45);
      crown3Geo = createOrganicFoliageGeometry(1.5, 0.65, 909);
      crown3Geo.translate(0.15, 4.95, 0.25);
      crown4Geo = createOrganicFoliageGeometry(1.35, 0.64, 969);
      crown4Geo.translate(-0.4, 4.35, -0.95);
    }

    const baseFoliageHex = isSakura
      ? 0xe89ab6
      : isCypress
        ? 0x264d38
        : isPine
          ? 0x24423d
          : 0x3f5e39;

    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: foliageTex.leafAlbedo,
      roughness: isSakura ? 0.84 : 0.88,
      metalness: 0.02,
    });

    const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, treePositions.length);
    const branches = new THREE.InstancedMesh(branchGeo, barkMat, treePositions.length);
    const branches2 = new THREE.InstancedMesh(branch2Geo, barkMat, treePositions.length);
    const crowns1 = new THREE.InstancedMesh(crown1Geo, foliageMat, treePositions.length);
    const crowns2 = new THREE.InstancedMesh(crown2Geo, foliageMat, treePositions.length);
    const crowns3 = new THREE.InstancedMesh(crown3Geo, foliageMat, treePositions.length);
    const crowns4 = new THREE.InstancedMesh(crown4Geo, foliageMat, treePositions.length);

    const baseCol = new THREE.Color(baseFoliageHex);
    treePositions.forEach((tp, idx) => {
      dummy.position.set(tp.x, tp.y - 0.25, tp.z);
      dummy.rotation.set(tp.leanX, tp.rotY, tp.leanZ);
      dummy.scale.setScalar(tp.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(idx, dummy.matrix);
      branches.setMatrixAt(idx, dummy.matrix);
      branches2.setMatrixAt(idx, dummy.matrix);
      crowns1.setMatrixAt(idx, dummy.matrix);
      crowns2.setMatrixAt(idx, dummy.matrix);
      crowns3.setMatrixAt(idx, dummy.matrix);
      crowns4.setMatrixAt(idx, dummy.matrix);

      tintColor.copy(baseCol).offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.09);
      crowns1.setColorAt(idx, tintColor.clone().offsetHSL(0, 0, -0.04));
      crowns2.setColorAt(idx, tintColor);
      crowns3.setColorAt(idx, tintColor.clone().offsetHSL(0, 0, 0.06));
      crowns4.setColorAt(idx, tintColor.clone().offsetHSL(0.01, 0, 0.03));
    });

    for (const m of [trunks, branches, branches2, crowns1, crowns2, crowns3, crowns4]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }

    group.add(trunks, branches, branches2, crowns1, crowns2, crowns3, crowns4);
  }

  // Low organic roadside scrub bushes
  if (bushPositions.length > 0) {
    const bushGeo = createOrganicFoliageGeometry(1.1, 0.62, 1212);
    bushGeo.translate(0, 0.45, 0);
    const bushMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: foliageTex.leafAlbedo,
      roughness: 0.92,
    });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushPositions.length);
    const bushCol = new THREE.Color(
      course.treeStyle === 'juniper'
        ? 0x56643a
        : course.treeStyle === 'pine'
          ? 0x2e4c46
          : 0x3b633c,
    );
    bushPositions.forEach((bp, idx) => {
      dummy.position.set(bp.x, bp.y - 0.42, bp.z);
      dummy.rotation.set(0, bp.rotY, 0);
      dummy.scale.setScalar(bp.scale);
      dummy.updateMatrix();
      bushes.setMatrixAt(idx, dummy.matrix);
      tintColor.copy(bushCol).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.1);
      bushes.setColorAt(idx, tintColor);
    });
    bushes.instanceMatrix.needsUpdate = true;
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    bushes.computeBoundingSphere();
    group.add(bushes);
  }

  // Craggy textured geological boulders embedded deeply into hillside slopes (zero floating!)
  if (rockPositions.length > 0) {
    const rockGeo = createOrganicFoliageGeometry(1.0, 0.82, 3434);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: terrainTex.albedo,
      bumpMap: terrainTex.bump,
      bumpScale: 0.52,
      roughness: 0.93,
      metalness: 0.03,
    });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockPositions.length);
    const baseRock = new THREE.Color(course.terrainLow).multiplyScalar(0.85);

    rockPositions.forEach((rp, idx) => {
      // Embed bottom half deeply into terrain slope so rocks never hover on angled hills
      dummy.position.set(rp.x, rp.y - rp.sy * 0.25 - 0.35, rp.z);
      dummy.rotation.set(0, rp.rotY, 0);
      dummy.scale.set(rp.sx, rp.sy, rp.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(idx, dummy.matrix);
      tintColor.copy(baseRock).offsetHSL(0, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.12);
      rocks.setColorAt(idx, tintColor);
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
    group.add(rocks);
  }

  // 8. Dynamic Collidable Flexible Motorsport Delineator Bollards (3D knock-down rigid-body physics!)
  const maxDynamicPosts = 220;
  const postGeo = new THREE.CylinderGeometry(0.068, 0.088, 0.96, 10);
  // Center geometry around mid-height (y = 0) so 3D tumbling rotates around center of mass,
  // while upright sync offsets y by +0.48m to plant rubber base cleanly on the shoulder
  const postMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: delineatorTex,
    roughness: 0.46,
    metalness: 0.14,
  });
  const postsMesh = new THREE.InstancedMesh(postGeo, postMat, maxDynamicPosts);
  postsMesh.frustumCulled = false;
  postsMesh.count = 0;
  group.add(postsMesh);

  const postDummy = new THREE.Object3D();
  postDummy.rotation.order = 'YXZ';
  const syncPosts = (postStates: RoadsidePostState[]) => {
    const n = Math.min(postStates.length, maxDynamicPosts);
    postsMesh.count = n;
    for (let i = 0; i < n; i++) {
      const p = postStates[i];
      // Upright base rests at p.y -> center is at p.y + 0.48; knocked/settled post uses ballistic center p.y + (upright blend)
      const centerY = p.knocked ? p.y + (p.settled ? 0.0 : 0.34) : p.y + 0.48;
      postDummy.position.set(p.x, centerY, p.z);
      postDummy.rotation.set(p.rx, p.ry, p.rz);
      postDummy.scale.setScalar(1);
      postDummy.updateMatrix();
      postsMesh.setMatrixAt(i, postDummy.matrix);
    }
    postsMesh.instanceMatrix.needsUpdate = true;
  };

  // 9. Ambient World Atmosphere Motes (Petals / Snow / Canyon Dust / Coastal Sea Mist)
  const isPetal = course.treeStyle === 'sakura';
  const isSnow = course.treeStyle === 'pine';
  const isHighAltitudeParticle = isPetal || isSnow;
  const ambientCount = isHighAltitudeParticle ? 140 : 75;
  const ambientMaxHeight = isHighAltitudeParticle ? 18 : 6.5;
  const ambientGeo = isPetal
    ? new THREE.PlaneGeometry(0.24, 0.14)
    : new THREE.OctahedronGeometry(isSnow ? 0.1 : 0.055, 0);
  const ambientMat = new THREE.MeshBasicMaterial({
    color: course.ambientParticleColor,
    transparent: true,
    opacity: isPetal ? 0.72 : isSnow ? 0.56 : 0.24,
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

  // 10. Pooled zero-GC gameplay particle ring buffer + persistent tire skidmark pool
  const particles = createParticlePool(260);
  group.add(particles.mesh);

  const skidmarks = createSkidmarkPool(360);
  group.add(skidmarks.mesh);

  const setAtmosphere = (cfg: SkyAtmosphereConfig) => {
    skyUniforms.uTopColor.value.set(cfg.topHex);
    skyUniforms.uMidColor.value.set(cfg.midHex);
    skyUniforms.uHorizonColor.value.set(cfg.horizonHex);
    skyUniforms.uSunColor.value.set(cfg.sunHex);
    skyUniforms.uSunDir.value.copy(cfg.sunDir).normalize();
    skyUniforms.uAuroraStrength.value = cfg.auroraStrength;
    skyUniforms.uStarStrength.value = cfg.starStrength;

    if (waterUniforms) {
      waterUniforms.uHorizonColor.value.set(cfg.horizonHex);
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
      ring.rotation.z = elapsed * 1.3 + i;
      ring.position.y = 3.55 + Math.sin(elapsed * 2.2 + i) * 0.25;
    }

    // Rotate Race Control rooftop weather/telemetry radar dish smoothly
    stationBuild.radarDish.rotation.y = elapsed * 0.65;

    // Gentle wind ripple on trackside motorsport pennant flags
    for (let i = 0; i < flagsBuild.flagMeshes.length; i++) {
      const f = flagsBuild.flagMeshes[i];
      f.mesh.rotation.y = Math.sin(elapsed * 3.1 + f.phase) * 0.16;
      f.mesh.rotation.z = Math.cos(elapsed * 2.3 + f.phase) * 0.04;
    }

    for (let i = 0; i < ambientCount; i++) {
      const a = ambientOffsets[i];
      const fall = isHighAltitudeParticle ? (elapsed * 1.5 * a.speed) % ambientMaxHeight : 0;
      const wx = focusX + a.ox + Math.sin(elapsed * 0.7 * a.speed + a.phase) * 3.5;
      const wy = focusY + ((a.oy - fall + ambientMaxHeight) % ambientMaxHeight) + 0.6;
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
    skidmarks.dispose();
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

  return { group, particles, skidmarks, syncPosts, setAtmosphere, update, dispose };
}
