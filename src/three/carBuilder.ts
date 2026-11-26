import * as THREE from 'three';
import type { CarState, LiveryConfig, PaintFinish, RimFinish } from '../game/types';
import {
  createDoorNumberTexture,
  createHoneycombGrilleTexture,
  createLicensePlateTexture,
  createLiveryTexture,
} from './textures';

export interface CarMeshRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  bodyMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  rimMaterial: THREE.MeshStandardMaterial;
  rotorMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  tailLightMaterial: THREE.MeshStandardMaterial;
  rainLampMaterial: THREE.MeshStandardMaterial;
  liveryMaterial: THREE.MeshStandardMaterial;
  doorMaterial: THREE.MeshStandardMaterial;
  plateMaterial: THREE.MeshStandardMaterial;
  beamMaterial: THREE.MeshBasicMaterial;
  liveryTexture: THREE.CanvasTexture | null;
  doorTexture: THREE.CanvasTexture | null;
  plateTexture: THREE.CanvasTexture | null;
  grilleTexture: THREE.CanvasTexture | null;
  frontWheelPivots: [THREE.Group, THREE.Group];
  wheelSpinMeshes: THREE.Object3D[];
  boostFlames: [THREE.Mesh, THREE.Mesh];
  headlightBeams: [THREE.Mesh, THREE.Mesh];
  shadowMesh: THREE.Mesh;
  baseBodyColor: THREE.Color;
  applyLivery: (config: LiveryConfig) => void;
  setHeadlightBoost: (intensity: number, beamOpacity?: number) => void;
  dispose: () => void;
}

function createBodyProfileGeometry(): THREE.ExtrudeGeometry {
  // Drawn in XY plane: X becomes +Z (front) after rotateY(-PI/2), Y stays +Y.
  // With depth=1.74 & bevelThickness=0.10 => exact outer X width is ±(0.87 + 0.10) = ±0.97.
  // With bevelSize=0.06 => front nose tip reaches z=+2.36, rear cutoff z=-2.36, hood top y=0.72..0.90.
  const shape = new THREE.Shape();
  shape.moveTo(-2.26, 0.28);
  shape.lineTo(2.26, 0.26); // low aero rocker sill
  shape.quadraticCurveTo(2.38, 0.36, 2.28, 0.56); // sleek GT nose cone
  shape.quadraticCurveTo(1.76, 0.72, 1.12, 0.80); // gently curved front bonnet
  shape.lineTo(0.46, 0.88); // windshield cowl
  shape.lineTo(-1.30, 0.90); // muscular rear haunch deck
  shape.quadraticCurveTo(-2.02, 0.88, -2.28, 0.82); // subtle integrated ducktail lip
  shape.lineTo(-2.30, 0.36); // crisp rear fascia cutoff
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.74,
    bevelEnabled: true,
    bevelThickness: 0.10,
    bevelSize: 0.06,
    bevelSegments: 4,
    curveSegments: 16,
  });
  geo.translate(0, 0, -0.87);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createCanopyGlassGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.44, 0.88);
  shape.lineTo(0.88, 0.86);
  shape.quadraticCurveTo(0.32, 1.32, -0.20, 1.35);
  shape.lineTo(-0.92, 1.32);
  shape.quadraticCurveTo(-1.26, 1.14, -1.44, 0.88);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.24,
    bevelEnabled: true,
    bevelThickness: 0.10,
    bevelSize: 0.06,
    bevelSegments: 4,
    curveSegments: 14,
  });
  geo.translate(0, 0, -0.62);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createRoofSkinGeometry(): THREE.ExtrudeGeometry {
  // Painted roof panel crowning the glass greenhouse so the car reads like a real sculpted GT coupe
  const shape = new THREE.Shape();
  shape.moveTo(-1.04, 1.31);
  shape.quadraticCurveTo(-0.46, 1.41, 0.18, 1.35);
  shape.lineTo(0.24, 1.28);
  shape.lineTo(-1.06, 1.25);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.08,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.04,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geo.translate(0, 0, -0.54);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createFenderArchGeometry(): THREE.ExtrudeGeometry {
  // Sculpted curved wheel-arch blister flare wrapping over each tire
  const shape = new THREE.Shape();
  shape.moveTo(-0.56, -0.14);
  shape.quadraticCurveTo(-0.46, 0.26, 0, 0.29);
  shape.quadraticCurveTo(0.46, 0.26, 0.56, -0.14);
  shape.lineTo(0.42, -0.14);
  shape.quadraticCurveTo(0.32, 0.14, 0, 0.16);
  shape.quadraticCurveTo(-0.32, 0.14, -0.42, -0.14);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.20,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geo.translate(0, 0, -0.10);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

let sharedGeos: {
  body: THREE.ExtrudeGeometry;
  canopyGlass: THREE.ExtrudeGeometry;
  roofSkin: THREE.ExtrudeGeometry;
  fenderArch: THREE.ExtrudeGeometry;
  cockpitTub: THREE.BoxGeometry;
  seatBack: THREE.BoxGeometry;
  dashboard: THREE.BoxGeometry;
  steeringWheel: THREE.TorusGeometry;
  rollBar: THREE.CylinderGeometry;
  pillar: THREE.BoxGeometry;
  bPillar: THREE.BoxGeometry;
  wiper: THREE.BoxGeometry;
  roofScoop: THREE.BoxGeometry;
  roofRail: THREE.BoxGeometry;
  hoodVent: THREE.BoxGeometry;
  sideSkirt: THREE.BoxGeometry;
  skirtWinglet: THREE.BoxGeometry;
  sideIntake: THREE.BoxGeometry;
  sideBlade: THREE.BoxGeometry;
  doorHandle: THREE.BoxGeometry;
  canard: THREE.BoxGeometry;
  mirrorHead: THREE.BoxGeometry;
  mirrorStalk: THREE.BoxGeometry;
  louver: THREE.BoxGeometry;
  splitter: THREE.BoxGeometry;
  splitterStrut: THREE.CylinderGeometry;
  grilleSurround: THREE.BoxGeometry;
  grille: THREE.BoxGeometry;
  brakeDuct: THREE.BoxGeometry;
  rearFascia: THREE.BoxGeometry;
  plateFrame: THREE.BoxGeometry;
  licensePlate: THREE.PlaneGeometry;
  diffuser: THREE.BoxGeometry;
  diffuserFin: THREE.BoxGeometry;
  exhaustOuter: THREE.CylinderGeometry;
  exhaustInner: THREE.CylinderGeometry;
  wingBlade: THREE.BoxGeometry;
  wingEndplate: THREE.BoxGeometry;
  wingPylon: THREE.BoxGeometry;
  headlightHousing: THREE.BoxGeometry;
  headlightProjector: THREE.CylinderGeometry;
  drlBlade: THREE.BoxGeometry;
  tailHousing: THREE.BoxGeometry;
  tailBar: THREE.BoxGeometry;
  tailPod: THREE.BoxGeometry;
  rainLamp: THREE.BoxGeometry;
  tire: THREE.CylinderGeometry;
  tireSidewall: THREE.TorusGeometry;
  rimBarrel: THREE.TorusGeometry;
  rimDrum: THREE.CylinderGeometry;
  rotor: THREE.CylinderGeometry;
  hubNut: THREE.CylinderGeometry;
  spoke: THREE.BoxGeometry;
  caliper: THREE.BoxGeometry;
  hoodDecal: THREE.PlaneGeometry;
  doorDecal: THREE.PlaneGeometry;
  headlightBeam: THREE.PlaneGeometry;
  flame: THREE.ConeGeometry;
  shadowPlane: THREE.PlaneGeometry;
} | null = null;

function getSharedCarGeometries() {
  if (sharedGeos) return sharedGeos;

  const tire = new THREE.CylinderGeometry(0.375, 0.375, 0.33, 28);
  tire.rotateZ(Math.PI / 2);

  const tireSidewall = new THREE.TorusGeometry(0.31, 0.065, 10, 24);
  tireSidewall.rotateY(Math.PI / 2);

  const rimBarrel = new THREE.TorusGeometry(0.245, 0.032, 10, 24);
  rimBarrel.rotateY(Math.PI / 2);

  const rimDrum = new THREE.CylinderGeometry(0.235, 0.235, 0.28, 22);
  rimDrum.rotateZ(Math.PI / 2);

  const rotor = new THREE.CylinderGeometry(0.195, 0.195, 0.12, 20);
  rotor.rotateZ(Math.PI / 2);

  const hubNut = new THREE.CylinderGeometry(0.052, 0.052, 0.34, 8);
  hubNut.rotateZ(Math.PI / 2);

  const exhaustOuter = new THREE.CylinderGeometry(0.072, 0.08, 0.34, 14);
  exhaustOuter.rotateX(Math.PI / 2);

  const exhaustInner = new THREE.CylinderGeometry(0.052, 0.052, 0.355, 12);
  exhaustInner.rotateX(Math.PI / 2);

  const headlightProjector = new THREE.CylinderGeometry(0.048, 0.052, 0.06, 12);
  headlightProjector.rotateX(Math.PI / 2);

  const flame = new THREE.ConeGeometry(0.12, 1.05, 10);
  flame.rotateX(-Math.PI / 2);
  flame.translate(0, 0, -0.5);

  const shadowPlane = new THREE.PlaneGeometry(2.9, 5.5);
  shadowPlane.rotateX(-Math.PI / 2);

  const hoodDecal = new THREE.PlaneGeometry(1.34, 1.32);
  hoodDecal.rotateX(-Math.PI / 2);

  const doorDecal = new THREE.PlaneGeometry(0.92, 0.44);

  const headlightBeam = new THREE.PlaneGeometry(1.85, 8.8);
  headlightBeam.rotateX(-Math.PI / 2);
  headlightBeam.translate(0, 0, 4.4);

  const licensePlate = new THREE.PlaneGeometry(0.56, 0.14);

  sharedGeos = {
    body: createBodyProfileGeometry(),
    canopyGlass: createCanopyGlassGeometry(),
    roofSkin: createRoofSkinGeometry(),
    fenderArch: createFenderArchGeometry(),
    cockpitTub: new THREE.BoxGeometry(1.16, 0.34, 1.48),
    seatBack: new THREE.BoxGeometry(0.36, 0.44, 0.12),
    dashboard: new THREE.BoxGeometry(1.1, 0.16, 0.34),
    steeringWheel: new THREE.TorusGeometry(0.11, 0.022, 8, 16),
    rollBar: new THREE.CylinderGeometry(0.026, 0.026, 1.06, 8),
    pillar: new THREE.BoxGeometry(0.055, 0.56, 0.065),
    bPillar: new THREE.BoxGeometry(0.045, 0.36, 0.08),
    wiper: new THREE.BoxGeometry(0.56, 0.018, 0.026),
    roofScoop: new THREE.BoxGeometry(0.36, 0.11, 0.66),
    roofRail: new THREE.BoxGeometry(0.048, 0.04, 1.12),
    hoodVent: new THREE.BoxGeometry(0.30, 0.032, 0.42),
    sideSkirt: new THREE.BoxGeometry(0.14, 0.085, 2.08),
    skirtWinglet: new THREE.BoxGeometry(0.04, 0.16, 0.24),
    sideIntake: new THREE.BoxGeometry(0.10, 0.26, 0.62),
    sideBlade: new THREE.BoxGeometry(0.06, 0.30, 0.08),
    doorHandle: new THREE.BoxGeometry(0.04, 0.032, 0.16),
    canard: new THREE.BoxGeometry(0.16, 0.032, 0.32),
    mirrorHead: new THREE.BoxGeometry(0.22, 0.09, 0.15),
    mirrorStalk: new THREE.BoxGeometry(0.14, 0.035, 0.055),
    louver: new THREE.BoxGeometry(0.92, 0.036, 0.16),
    splitter: new THREE.BoxGeometry(2.04, 0.065, 0.54),
    splitterStrut: new THREE.CylinderGeometry(0.014, 0.014, 0.22, 6),
    grilleSurround: new THREE.BoxGeometry(1.36, 0.23, 0.08),
    grille: new THREE.BoxGeometry(1.26, 0.18, 0.07),
    brakeDuct: new THREE.BoxGeometry(0.28, 0.16, 0.09),
    rearFascia: new THREE.BoxGeometry(1.76, 0.22, 0.07),
    plateFrame: new THREE.BoxGeometry(0.62, 0.18, 0.04),
    licensePlate,
    diffuser: new THREE.BoxGeometry(1.80, 0.22, 0.38),
    diffuserFin: new THREE.BoxGeometry(0.045, 0.24, 0.40),
    exhaustOuter,
    exhaustInner,
    wingBlade: new THREE.BoxGeometry(2.02, 0.065, 0.38),
    wingEndplate: new THREE.BoxGeometry(0.05, 0.3, 0.46),
    wingPylon: new THREE.BoxGeometry(0.06, 0.36, 0.24),
    headlightHousing: new THREE.BoxGeometry(0.48, 0.105, 0.12),
    headlightProjector,
    drlBlade: new THREE.BoxGeometry(0.46, 0.024, 0.05),
    tailHousing: new THREE.BoxGeometry(1.78, 0.14, 0.08),
    tailBar: new THREE.BoxGeometry(1.70, 0.042, 0.06),
    tailPod: new THREE.BoxGeometry(0.36, 0.092, 0.07),
    rainLamp: new THREE.BoxGeometry(0.11, 0.13, 0.06),
    tire,
    tireSidewall,
    rimBarrel,
    rimDrum,
    rotor,
    hubNut,
    spoke: new THREE.BoxGeometry(0.28, 0.44, 0.042),
    caliper: new THREE.BoxGeometry(0.14, 0.18, 0.13),
    hoodDecal,
    doorDecal,
    headlightBeam,
    flame,
    shadowPlane,
  };
  return sharedGeos;
}

function applyPaintFinish(mat: THREE.MeshPhysicalMaterial, finish: PaintFinish): void {
  if (finish === 'gloss') {
    mat.metalness = 0.24;
    mat.roughness = 0.2;
    mat.clearcoat = 0.95;
    mat.clearcoatRoughness = 0.08;
    mat.envMapIntensity = 0.72;
  } else if (finish === 'matte') {
    mat.metalness = 0.14;
    mat.roughness = 0.66;
    mat.clearcoat = 0.06;
    mat.clearcoatRoughness = 0.55;
    mat.envMapIntensity = 0.36;
  } else {
    mat.metalness = 0.56;
    mat.roughness = 0.24;
    mat.clearcoat = 0.84;
    mat.clearcoatRoughness = 0.12;
    mat.envMapIntensity = 0.78;
  }
  mat.needsUpdate = true;
}

function applyRimFinish(mat: THREE.MeshStandardMaterial, finish: RimFinish): void {
  if (finish === 'gold') {
    mat.color.setHex(0xc9a14d);
    mat.metalness = 0.9;
    mat.roughness = 0.22;
  } else if (finish === 'obsidian') {
    mat.color.setHex(0x1f2530);
    mat.metalness = 0.78;
    mat.roughness = 0.28;
  } else if (finish === 'copper') {
    mat.color.setHex(0xb86841);
    mat.metalness = 0.88;
    mat.roughness = 0.24;
  } else {
    mat.color.setHex(0xc8d2de);
    mat.metalness = 0.92;
    mat.roughness = 0.18;
  }
  mat.needsUpdate = true;
}

export function buildCompositeCar(opts: {
  bodyColor: string;
  accentColor: string;
  contactShadowTex: THREE.CanvasTexture;
  headlightBeamTex: THREE.CanvasTexture;
  maxAnisotropy: number;
  initialConfig?: LiveryConfig;
  racingNumber?: string;
}): CarMeshRig {
  const geos = getSharedCarGeometries();
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const baseBodyColor = new THREE.Color(opts.bodyColor);
  const numStr = opts.initialConfig?.racingNumber || opts.racingNumber || '07';

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: baseBodyColor.clone(),
    metalness: 0.52,
    roughness: 0.25,
    clearcoat: 0.84,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.76,
  });
  if (opts.initialConfig) {
    applyPaintFinish(bodyMaterial, opts.initialConfig.paintFinish);
  }

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.accentColor),
    metalness: 0.42,
    roughness: 0.32,
    envMapIntensity: 0.65,
  });

  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x161b23,
    metalness: 0.24,
    roughness: 0.64,
    envMapIntensity: 0.48,
  });

  const interiorMaterial = new THREE.MeshStandardMaterial({
    color: 0x14171d,
    metalness: 0.06,
    roughness: 0.88,
  });

  const seatTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0x262c36,
    metalness: 0.08,
    roughness: 0.82,
  });

  const grilleTexture = createHoneycombGrilleTexture(opts.maxAnisotropy);
  const grilleMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: grilleTexture,
    metalness: 0.45,
    roughness: 0.55,
  });

  // Tinted semi-transparent automotive glass revealing cockpit seats & rollcage inside
  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0d1522,
    metalness: 0.16,
    roughness: 0.08,
    clearcoat: 0.96,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.64,
    envMapIntensity: 0.9,
  });

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8d2de,
    metalness: 0.92,
    roughness: 0.18,
    envMapIntensity: 0.9,
  });
  if (opts.initialConfig) {
    applyRimFinish(rimMaterial, opts.initialConfig.rimFinish);
  }

  const titaniumTipMaterial = new THREE.MeshStandardMaterial({
    color: 0x9aa8bc,
    metalness: 0.94,
    roughness: 0.2,
  });

  const darkBoreMaterial = new THREE.MeshStandardMaterial({
    color: 0x06070a,
    roughness: 0.95,
    metalness: 0.1,
  });

  const rotorMaterial = new THREE.MeshStandardMaterial({
    color: 0x7a828f,
    emissive: 0xd9480f,
    emissiveIntensity: 0.04,
    metalness: 0.82,
    roughness: 0.34,
  });

  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x16191f,
    metalness: 0.03,
    roughness: 0.92,
  });

  // Calibrated natural automotive LED lights (crisp & authentic, never blinding!)
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9f5e8,
    emissive: 0xffe8bd,
    emissiveIntensity: 0.72,
    roughness: 0.14,
  });

  const tailLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xd92626,
    emissive: 0xcc1818,
    emissiveIntensity: 0.58,
    roughness: 0.2,
  });

  const rainLampMaterial = new THREE.MeshStandardMaterial({
    color: 0xe11d24,
    emissive: 0xd91c22,
    emissiveIntensity: 0.45,
    roughness: 0.24,
  });

  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.82,
  });

  // Subtle normal-blended soft road beam pool (active only at Twilight/Glacier)
  const beamMaterial = new THREE.MeshBasicMaterial({
    map: opts.headlightBeamTex,
    transparent: true,
    opacity: 0.0,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });

  // 1. Primary sculpted beveled fuselage (outer X = ±0.97, nose Z = +2.36, rear Z = -2.36)
  const bodyMesh = new THREE.Mesh(geos.body, bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);

  // 2. Visible cockpit interior (tub, twin racing bucket seats, dashboard, steering wheel, FIA rollbar)
  const tub = new THREE.Mesh(geos.cockpitTub, interiorMaterial);
  tub.position.set(0, 0.92, -0.2);
  bodyGroup.add(tub);

  for (const sx of [-0.28, 0.28]) {
    const seat = new THREE.Mesh(geos.seatBack, seatTrimMaterial);
    seat.position.set(sx, 1.07, -0.45);
    seat.rotation.x = -0.22;
    bodyGroup.add(seat);
  }

  const dash = new THREE.Mesh(geos.dashboard, interiorMaterial);
  dash.position.set(0, 1.02, 0.34);
  bodyGroup.add(dash);

  const steerWheel = new THREE.Mesh(geos.steeringWheel, carbonMaterial);
  steerWheel.position.set(-0.28, 1.08, 0.18);
  steerWheel.rotation.x = 0.28;
  bodyGroup.add(steerWheel);

  const rollHoops = new THREE.Mesh(geos.rollBar, accentMaterial);
  rollHoops.position.set(0, 1.18, -0.68);
  rollHoops.rotation.z = Math.PI / 2;
  bodyGroup.add(rollHoops);

  // 3. Tinted glass greenhouse + Painted Roof Panel + Flush A/B/C Pillars + Windshield Wiper
  const canopyMesh = new THREE.Mesh(geos.canopyGlass, canopyMaterial);
  canopyMesh.castShadow = true;
  bodyGroup.add(canopyMesh);

  const roofSkin = new THREE.Mesh(geos.roofSkin, bodyMaterial);
  roofSkin.castShadow = true;
  bodyGroup.add(roofSkin);

  for (const side of [-1, 1]) {
    // Properly rear-raked A-pillars flush along windshield glass edges
    const aPillar = new THREE.Mesh(geos.pillar, carbonMaterial);
    aPillar.position.set(side * 0.64, 1.12, 0.44);
    aPillar.rotation.set(-0.78, 0, side * 0.15);
    bodyGroup.add(aPillar);

    // Side B-pillar vertical divider
    const bPillar = new THREE.Mesh(geos.bPillar, carbonMaterial);
    bPillar.position.set(side * 0.68, 1.12, -0.34);
    bPillar.rotation.z = side * 0.16;
    bodyGroup.add(bPillar);

    // Forward-raked C-pillar rear buttresses
    const cPillar = new THREE.Mesh(geos.pillar, bodyMaterial);
    cPillar.position.set(side * 0.63, 1.11, -1.04);
    cPillar.rotation.set(0.76, 0, side * 0.14);
    bodyGroup.add(cPillar);

    // Twin aerodynamic roof strake rails
    const rail = new THREE.Mesh(geos.roofRail, accentMaterial);
    rail.position.set(side * 0.48, 1.38, -0.45);
    bodyGroup.add(rail);
  }

  const wiper = new THREE.Mesh(geos.wiper, carbonMaterial);
  wiper.position.set(-0.08, 0.96, 0.72);
  wiper.rotation.set(-0.65, 0.08, 0.1);
  bodyGroup.add(wiper);

  const roofScoop = new THREE.Mesh(geos.roofScoop, carbonMaterial);
  roofScoop.position.set(0, 1.41, -0.34);
  bodyGroup.add(roofScoop);

  // 4. Twin sculpted hood heat-extractor vents & Rear engine deck carbon louvers (cleanly proud of hood y=0.84)
  for (const side of [-1, 1]) {
    const hVent = new THREE.Mesh(geos.hoodVent, grilleMaterial);
    hVent.position.set(side * 0.56, 0.855, 1.24);
    hVent.rotation.x = 0.135;
    bodyGroup.add(hVent);
  }

  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(geos.louver, carbonMaterial);
    slat.position.set(0, 1.00 - i * 0.035, -1.26 - i * 0.22);
    slat.rotation.x = 0.18;
    bodyGroup.add(slat);
  }

  // 5. Carbon side skirts + winglets + recessed side air intakes + door-mounted stalked mirrors + handles + canards
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(geos.sideSkirt, carbonMaterial);
    skirt.position.set(side * 0.99, 0.22, 0.02);
    bodyGroup.add(skirt);

    const winglet = new THREE.Mesh(geos.skirtWinglet, carbonMaterial);
    winglet.position.set(side * 1.04, 0.29, -0.84);
    bodyGroup.add(winglet);

    const intake = new THREE.Mesh(geos.sideIntake, grilleMaterial);
    intake.position.set(side * 0.95, 0.59, -0.58);
    bodyGroup.add(intake);

    const intakeBlade = new THREE.Mesh(geos.sideBlade, bodyMaterial);
    intakeBlade.position.set(side * 0.99, 0.59, -0.32);
    intakeBlade.rotation.y = side * -0.22;
    bodyGroup.add(intakeBlade);

    const handle = new THREE.Mesh(geos.doorHandle, rimMaterial);
    handle.position.set(side * 0.985, 0.80, -0.18);
    bodyGroup.add(handle);

    const mirrorStalk = new THREE.Mesh(geos.mirrorStalk, carbonMaterial);
    mirrorStalk.position.set(side * 0.92, 0.94, 0.34);
    mirrorStalk.rotation.z = side * 0.28;
    bodyGroup.add(mirrorStalk);

    const mirrorHead = new THREE.Mesh(geos.mirrorHead, bodyMaterial);
    mirrorHead.position.set(side * 1.04, 0.98, 0.33);
    mirrorHead.rotation.y = side * -0.12;
    bodyGroup.add(mirrorHead);

    const canard = new THREE.Mesh(geos.canard, carbonMaterial);
    canard.position.set(side * 0.97, 0.38, 2.02);
    canard.rotation.z = side * 0.22;
    bodyGroup.add(canard);

    const brakeDuct = new THREE.Mesh(geos.brakeDuct, grilleMaterial);
    brakeDuct.position.set(side * 0.74, 0.36, 2.34);
    brakeDuct.rotation.y = side * 0.16;
    bodyGroup.add(brakeDuct);

    // Front splitter stainless support tie-rods
    const strut = new THREE.Mesh(geos.splitterStrut, rimMaterial);
    strut.position.set(side * 0.46, 0.32, 2.39);
    strut.rotation.x = 0.18;
    bodyGroup.add(strut);
  }

  // 6. Sculpted curved wheel-arch blister flares cleanly proud of ±0.97 flanks
  const archOffsets: Array<[number, number, number]> = [
    [-0.93, 0.45, 1.32],
    [0.93, 0.45, 1.32],
    [-0.95, 0.48, -1.28],
    [0.95, 0.48, -1.28],
  ];
  for (const [fx, fy, fz] of archOffsets) {
    const arch = new THREE.Mesh(geos.fenderArch, bodyMaterial);
    arch.position.set(fx, fy, fz);
    arch.castShadow = true;
    bodyGroup.add(arch);
  }

  // 7. Front carbon aero splitter + framed honeycomb radiator grille (cleanly proud of z=+2.36 nose!)
  const splitter = new THREE.Mesh(geos.splitter, carbonMaterial);
  splitter.position.set(0, 0.21, 2.26);
  bodyGroup.add(splitter);

  const grilleSurround = new THREE.Mesh(geos.grilleSurround, carbonMaterial);
  grilleSurround.position.set(0, 0.37, 2.365);
  bodyGroup.add(grilleSurround);

  const grille = new THREE.Mesh(geos.grille, grilleMaterial);
  grille.position.set(0, 0.37, 2.385);
  bodyGroup.add(grille);

  // 8. Rear honeycomb heat-vent fascia + framed GT license plate + carbon diffuser + twin titanium exhausts
  const rearFascia = new THREE.Mesh(geos.rearFascia, grilleMaterial);
  rearFascia.position.set(0, 0.72, -2.35);
  bodyGroup.add(rearFascia);

  const plateFrame = new THREE.Mesh(geos.plateFrame, carbonMaterial);
  plateFrame.position.set(0, 0.53, -2.375);
  bodyGroup.add(plateFrame);

  let plateTexture: THREE.CanvasTexture | null = createLicensePlateTexture(
    numStr,
    opts.accentColor,
    opts.maxAnisotropy,
  );
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: plateTexture,
    roughness: 0.42,
    metalness: 0.18,
  });
  const plateMesh = new THREE.Mesh(geos.licensePlate, plateMaterial);
  plateMesh.position.set(0, 0.53, -2.402);
  plateMesh.rotation.y = Math.PI;
  bodyGroup.add(plateMesh);

  const diffuser = new THREE.Mesh(geos.diffuser, carbonMaterial);
  diffuser.position.set(0, 0.31, -2.28);
  bodyGroup.add(diffuser);

  for (const finX of [-0.68, -0.22, 0.22, 0.68]) {
    const fin = new THREE.Mesh(geos.diffuserFin, carbonMaterial);
    fin.position.set(finX, 0.28, -2.32);
    bodyGroup.add(fin);
  }

  const rainLamp = new THREE.Mesh(geos.rainLamp, rainLampMaterial);
  rainLamp.position.set(0, 0.33, -2.47);
  bodyGroup.add(rainLamp);

  for (const ex of [-0.46, 0.46]) {
    const pipe = new THREE.Mesh(geos.exhaustOuter, titaniumTipMaterial);
    pipe.position.set(ex, 0.32, -2.40);
    bodyGroup.add(pipe);

    const bore = new THREE.Mesh(geos.exhaustInner, darkBoreMaterial);
    bore.position.set(ex, 0.32, -2.405);
    bodyGroup.add(bore);
  }

  const flameLeft = new THREE.Mesh(geos.flame, flameMaterial);
  flameLeft.position.set(-0.46, 0.32, -2.52);
  flameLeft.visible = false;
  bodyGroup.add(flameLeft);

  const flameRight = new THREE.Mesh(geos.flame, flameMaterial);
  flameRight.position.set(0.46, 0.32, -2.52);
  flameRight.visible = false;
  bodyGroup.add(flameRight);

  // 9. Sculpted GT Rear Wing with swan-neck pylons & painted endplates
  const wingBlade = new THREE.Mesh(geos.wingBlade, carbonMaterial);
  wingBlade.position.set(0, 1.24, -2.06);
  wingBlade.rotation.x = 0.08;
  wingBlade.castShadow = true;
  bodyGroup.add(wingBlade);

  for (const side of [-1, 1]) {
    const endp = new THREE.Mesh(geos.wingEndplate, accentMaterial);
    endp.position.set(side * 1.01, 1.21, -2.06);
    bodyGroup.add(endp);

    const pylon = new THREE.Mesh(geos.wingPylon, carbonMaterial);
    pylon.position.set(side * 0.54, 1.04, -1.98);
    pylon.rotation.x = -0.14;
    bodyGroup.add(pylon);
  }

  // 10. Flush Sculpted Twin-Projector Headlights + Sharp LED DRL Blades + Smoked Quad Tail Bar
  for (const side of [-1, 1]) {
    const hlGroup = new THREE.Group();
    hlGroup.position.set(side * 0.65, 0.51, 2.31);
    hlGroup.rotation.set(0.16, side * 0.14, side * -0.05);

    const hlHousing = new THREE.Mesh(geos.headlightHousing, carbonMaterial);
    hlGroup.add(hlHousing);

    // Twin round projector lenses recessed flush inside dark smoked headlamp housing
    for (const px of [-0.11, 0.11]) {
      const proj = new THREE.Mesh(geos.headlightProjector, headlightMaterial);
      proj.position.set(px, 0.01, 0.052);
      hlGroup.add(proj);
    }

    // Crisp lower LED Daytime Running Light signature strip
    const drl = new THREE.Mesh(geos.drlBlade, headlightMaterial);
    drl.position.set(0, -0.042, 0.058);
    hlGroup.add(drl);

    bodyGroup.add(hlGroup);

    const pod = new THREE.Mesh(geos.tailPod, tailLightMaterial);
    pod.position.set(side * 0.65, 0.74, -2.40);
    bodyGroup.add(pod);
  }

  const tailHousing = new THREE.Mesh(geos.tailHousing, carbonMaterial);
  tailHousing.position.set(0, 0.74, -2.37);
  bodyGroup.add(tailHousing);

  const tailBar = new THREE.Mesh(geos.tailBar, tailLightMaterial);
  tailBar.position.set(0, 0.74, -2.40);
  bodyGroup.add(tailBar);

  // 11. Hood Livery Decal Plate & Side Door Number Roundels (cleanly proud of exact body contour!)
  let liveryTexture: THREE.CanvasTexture | null = opts.initialConfig
    ? createLiveryTexture(opts.initialConfig, opts.maxAnisotropy)
    : null;
  let doorTexture: THREE.CanvasTexture | null = createDoorNumberTexture(
    numStr,
    opts.accentColor,
    opts.maxAnisotropy,
  );

  const liveryMaterial = new THREE.MeshStandardMaterial({
    color: liveryTexture ? 0xffffff : new THREE.Color(opts.accentColor),
    map: liveryTexture,
    roughness: 0.30,
    metalness: 0.22,
    envMapIntensity: 0.62,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const hoodDecal = new THREE.Mesh(geos.hoodDecal, liveryMaterial);
  hoodDecal.position.set(0, 0.845, 1.36);
  hoodDecal.rotation.x = 0.135;
  bodyGroup.add(hoodDecal);

  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: doorTexture,
    transparent: true,
    roughness: 0.34,
    metalness: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const doorL = new THREE.Mesh(geos.doorDecal, doorMaterial);
  doorL.position.set(-0.985, 0.61, 0.18);
  doorL.rotation.y = -Math.PI / 2;
  bodyGroup.add(doorL);

  const doorR = new THREE.Mesh(geos.doorDecal, doorMaterial);
  doorR.position.set(0.985, 0.61, 0.18);
  doorR.rotation.y = Math.PI / 2;
  bodyGroup.add(doorR);

  // 12. Four deep-dish forged alloy wheels (tire + rounded sidewall + rim lip + drum + 5 spokes + rotor + nut + 6-piston caliper)
  const wheelSpinMeshes: THREE.Object3D[] = [];
  const frontLeftPivot = new THREE.Group();
  const frontRightPivot = new THREE.Group();

  const wheelConfigs: Array<{ x: number; z: number; pivot?: THREE.Group }> = [
    { x: -0.96, z: 1.32, pivot: frontLeftPivot },
    { x: 0.96, z: 1.32, pivot: frontRightPivot },
    { x: -0.98, z: -1.28 },
    { x: 0.98, z: -1.28 },
  ];

  for (const wc of wheelConfigs) {
    const wheelAssembly = new THREE.Group();
    const outSign = wc.x < 0 ? -1 : 1;

    const tireMesh = new THREE.Mesh(geos.tire, tireMaterial);
    tireMesh.castShadow = true;
    wheelAssembly.add(tireMesh);

    const sidewall = new THREE.Mesh(geos.tireSidewall, tireMaterial);
    sidewall.position.x = outSign * 0.115;
    wheelAssembly.add(sidewall);

    const rimBarrel = new THREE.Mesh(geos.rimBarrel, rimMaterial);
    rimBarrel.position.x = outSign * 0.14;
    wheelAssembly.add(rimBarrel);

    const rimDrum = new THREE.Mesh(geos.rimDrum, darkBoreMaterial);
    wheelAssembly.add(rimDrum);

    const rotorMesh = new THREE.Mesh(geos.rotor, rotorMaterial);
    rotorMesh.position.x = outSign * 0.04;
    wheelAssembly.add(rotorMesh);

    const nutMesh = new THREE.Mesh(geos.hubNut, accentMaterial);
    wheelAssembly.add(nutMesh);

    // 5-spoke forged star geometry
    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(geos.spoke, rimMaterial);
      spoke.position.x = outSign * 0.025;
      spoke.rotation.x = (s * Math.PI) / 5;
      wheelAssembly.add(spoke);
    }

    wheelSpinMeshes.push(wheelAssembly);

    if (wc.pivot) {
      wc.pivot.position.set(wc.x, 0.375, wc.z);
      const caliper = new THREE.Mesh(geos.caliper, accentMaterial);
      caliper.position.set(outSign * 0.06, 0.04, -0.14);
      wc.pivot.add(caliper);
      wc.pivot.add(wheelAssembly);
      root.add(wc.pivot);
    } else {
      const rearHub = new THREE.Group();
      rearHub.position.set(wc.x, 0.375, wc.z);
      const caliper = new THREE.Mesh(geos.caliper, accentMaterial);
      caliper.position.set(outSign * 0.06, 0.04, 0.14);
      rearHub.add(caliper);
      rearHub.add(wheelAssembly);
      root.add(rearHub);
    }
  }

  // 13. Subtle soft road-projected headlight pool (visible only in Twilight/Glacier)
  const beamLeft = new THREE.Mesh(geos.headlightBeam, beamMaterial);
  beamLeft.position.set(-0.68, 0.06, 2.38);
  beamLeft.visible = false;
  root.add(beamLeft);

  const beamRight = new THREE.Mesh(geos.headlightBeam, beamMaterial);
  beamRight.position.set(0.68, 0.06, 2.38);
  beamRight.visible = false;
  root.add(beamRight);

  // 14. Grounded radial contact shadow disc
  const shadowMat = new THREE.MeshBasicMaterial({
    map: opts.contactShadowTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(geos.shadowPlane, shadowMat);
  shadowMesh.position.y = 0.048;
  root.add(shadowMesh);

  const applyLivery = (config: LiveryConfig) => {
    baseBodyColor.set(config.bodyColor);
    bodyMaterial.color.copy(baseBodyColor);
    applyPaintFinish(bodyMaterial, config.paintFinish);
    accentMaterial.color.set(config.accentColor);
    applyRimFinish(rimMaterial, config.rimFinish);
    if (liveryTexture) liveryTexture.dispose();
    liveryTexture = createLiveryTexture(config, opts.maxAnisotropy);
    liveryMaterial.map = liveryTexture;
    liveryMaterial.color.setHex(0xffffff);
    liveryMaterial.needsUpdate = true;

    if (doorTexture) doorTexture.dispose();
    doorTexture = createDoorNumberTexture(config.racingNumber, config.accentColor, opts.maxAnisotropy);
    doorMaterial.map = doorTexture;
    doorMaterial.needsUpdate = true;

    if (plateTexture) plateTexture.dispose();
    plateTexture = createLicensePlateTexture(config.racingNumber, config.accentColor, opts.maxAnisotropy);
    plateMaterial.map = plateTexture;
    plateMaterial.needsUpdate = true;
  };

  const setHeadlightBoost = (intensity: number, beamOpacity = 0.0) => {
    headlightMaterial.emissiveIntensity = intensity;
    beamMaterial.opacity = beamOpacity;
    const showBeams = beamOpacity > 0.02;
    beamLeft.visible = showBeams;
    beamRight.visible = showBeams;
  };

  const dispose = () => {
    bodyMaterial.dispose();
    accentMaterial.dispose();
    carbonMaterial.dispose();
    interiorMaterial.dispose();
    seatTrimMaterial.dispose();
    grilleMaterial.dispose();
    canopyMaterial.dispose();
    rimMaterial.dispose();
    titaniumTipMaterial.dispose();
    darkBoreMaterial.dispose();
    rotorMaterial.dispose();
    tireMaterial.dispose();
    headlightMaterial.dispose();
    tailLightMaterial.dispose();
    rainLampMaterial.dispose();
    flameMaterial.dispose();
    beamMaterial.dispose();
    liveryMaterial.dispose();
    doorMaterial.dispose();
    plateMaterial.dispose();
    shadowMat.dispose();
    if (liveryTexture) liveryTexture.dispose();
    if (doorTexture) doorTexture.dispose();
    if (plateTexture) plateTexture.dispose();
    if (grilleTexture) grilleTexture.dispose();
  };

  return {
    root,
    bodyGroup,
    bodyMaterial,
    accentMaterial,
    rimMaterial,
    rotorMaterial,
    headlightMaterial,
    tailLightMaterial,
    rainLampMaterial,
    liveryMaterial,
    doorMaterial,
    plateMaterial,
    beamMaterial,
    liveryTexture,
    doorTexture,
    plateTexture,
    grilleTexture,
    frontWheelPivots: [frontLeftPivot, frontRightPivot],
    wheelSpinMeshes,
    boostFlames: [flameLeft, flameRight],
    headlightBeams: [beamLeft, beamRight],
    shadowMesh,
    baseBodyColor,
    applyLivery,
    setHeadlightBoost,
    dispose,
  };
}

const _flashWhite = new THREE.Color(0xffffff);

export function syncCarRigToState(
  rig: CarMeshRig,
  state: CarState,
  bankAngle: number,
  isBraking: boolean,
  elapsedTime: number,
): void {
  rig.root.position.set(state.x, state.y, state.z);
  rig.root.rotation.order = 'YXZ';
  rig.root.rotation.y = state.heading;
  rig.root.rotation.z = state.airborne ? 0 : -bankAngle;

  rig.bodyGroup.position.y = state.suspensionBounce;
  rig.bodyGroup.rotation.x = state.pitch;
  rig.bodyGroup.rotation.z = state.roll;

  const altitude = Math.max(0, state.y - state.groundY);
  rig.shadowMesh.position.y = 0.048 - altitude;
  const shadowScale = Math.max(0.55, 1 - altitude * 0.055);
  rig.shadowMesh.scale.set(shadowScale, 1, shadowScale);
  rig.headlightBeams[0].position.y = 0.06 - altitude;
  rig.headlightBeams[1].position.y = 0.06 - altitude;

  rig.frontWheelPivots[0].rotation.y = state.steerAngle;
  rig.frontWheelPivots[1].rotation.y = state.steerAngle;
  for (const w of rig.wheelSpinMeshes) {
    w.rotation.x = state.wheelSpin;
  }

  const boosting = state.isBoosting || state.padBoostTimer > 0;
  // Grounded realistic brake light response (zero retina burn)
  rig.tailLightMaterial.emissiveIntensity = isBraking ? 1.35 : boosting ? 0.95 : 0.55;
  rig.rotorMaterial.emissiveIntensity = isBraking && Math.abs(state.speed) > 12 ? 0.85 : 0.04;
  const strobe = Math.sin(elapsedTime * 18) > 0 ? 1.15 : 0.35;
  rig.rainLampMaterial.emissiveIntensity = boosting || isBraking ? strobe : 0.38;

  for (const flame of rig.boostFlames) {
    flame.visible = boosting;
    if (boosting) {
      const mat = flame.material as THREE.MeshBasicMaterial;
      mat.color.setHex(state.padBoostTimer > 0 ? 0x38bdf8 : 0xf59e0b);
      const flicker = 0.85 + Math.sin(elapsedTime * 54) * 0.22;
      flame.scale.set(1, 1, flicker * 1.24);
    }
  }

  if (state.hitFlashTimer > 0) {
    rig.bodyMaterial.emissive.copy(_flashWhite);
    rig.bodyMaterial.emissiveIntensity = 0.28;
  } else {
    rig.bodyMaterial.emissive.setHex(0x000000);
    rig.bodyMaterial.emissiveIntensity = 0;
  }
}
