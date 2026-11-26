import * as THREE from 'three';
import type { CarState, LiveryConfig, PaintFinish, RimFinish } from '../game/types';
import { createDoorNumberTexture, createLiveryTexture } from './textures';

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
  beamMaterial: THREE.MeshBasicMaterial;
  liveryTexture: THREE.CanvasTexture | null;
  doorTexture: THREE.CanvasTexture | null;
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
  const shape = new THREE.Shape();
  shape.moveTo(-2.28, 0.33);
  shape.lineTo(2.32, 0.3); // lower aero sill
  shape.quadraticCurveTo(2.48, 0.44, 2.32, 0.64); // sculpted aerodynamic nose
  shape.lineTo(1.24, 0.83); // low sculpted hood
  shape.lineTo(0.45, 0.94); // cowl
  shape.lineTo(-1.38, 0.95); // rear deck
  shape.lineTo(-2.3, 0.89); // ducktail lip
  shape.lineTo(-2.34, 0.45); // rear diffuser cutoff
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.76,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.1,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geo.translate(0, 0, -0.88);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createCanopyGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.48, 0.87);
  shape.lineTo(0.9, 0.85);
  shape.quadraticCurveTo(0.32, 1.35, -0.18, 1.36);
  shape.lineTo(-0.94, 1.31);
  shape.quadraticCurveTo(-1.32, 1.13, -1.48, 0.87);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.24,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.08,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -0.62);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

let sharedGeos: {
  body: THREE.ExtrudeGeometry;
  canopy: THREE.ExtrudeGeometry;
  roofScoop: THREE.BoxGeometry;
  roofRail: THREE.BoxGeometry;
  sideSkirt: THREE.BoxGeometry;
  sideIntake: THREE.BoxGeometry;
  canard: THREE.BoxGeometry;
  mirror: THREE.BoxGeometry;
  louver: THREE.BoxGeometry;
  fender: THREE.BoxGeometry;
  splitter: THREE.BoxGeometry;
  grille: THREE.BoxGeometry;
  diffuser: THREE.BoxGeometry;
  diffuserFin: THREE.BoxGeometry;
  exhaust: THREE.CylinderGeometry;
  wingBlade: THREE.BoxGeometry;
  wingEndplate: THREE.BoxGeometry;
  wingPylon: THREE.BoxGeometry;
  headlight: THREE.BoxGeometry;
  drlBlade: THREE.BoxGeometry;
  tailBar: THREE.BoxGeometry;
  tailPod: THREE.BoxGeometry;
  rainLamp: THREE.BoxGeometry;
  tire: THREE.CylinderGeometry;
  rim: THREE.CylinderGeometry;
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

  const tire = new THREE.CylinderGeometry(0.37, 0.37, 0.32, 22);
  tire.rotateZ(Math.PI / 2);

  const rim = new THREE.CylinderGeometry(0.255, 0.255, 0.33, 18);
  rim.rotateZ(Math.PI / 2);

  const rotor = new THREE.CylinderGeometry(0.195, 0.195, 0.336, 14);
  rotor.rotateZ(Math.PI / 2);

  const hubNut = new THREE.CylinderGeometry(0.055, 0.055, 0.35, 8);
  hubNut.rotateZ(Math.PI / 2);

  const exhaust = new THREE.CylinderGeometry(0.07, 0.08, 0.32, 10);
  exhaust.rotateX(Math.PI / 2);

  const flame = new THREE.ConeGeometry(0.135, 1.15, 8);
  flame.rotateX(-Math.PI / 2);
  flame.translate(0, 0, -0.55);

  const shadowPlane = new THREE.PlaneGeometry(2.85, 5.45);
  shadowPlane.rotateX(-Math.PI / 2);

  const hoodDecal = new THREE.PlaneGeometry(1.38, 1.44);
  hoodDecal.rotateX(-Math.PI / 2);

  const doorDecal = new THREE.PlaneGeometry(0.96, 0.48);

  const headlightBeam = new THREE.PlaneGeometry(1.7, 9.6);
  headlightBeam.rotateX(-Math.PI / 2);
  headlightBeam.translate(0, 0, 4.8);

  sharedGeos = {
    body: createBodyProfileGeometry(),
    canopy: createCanopyGeometry(),
    roofScoop: new THREE.BoxGeometry(0.38, 0.14, 0.74),
    roofRail: new THREE.BoxGeometry(0.06, 0.06, 1.18),
    sideSkirt: new THREE.BoxGeometry(0.14, 0.09, 2.04),
    sideIntake: new THREE.BoxGeometry(0.12, 0.28, 0.62),
    canard: new THREE.BoxGeometry(0.16, 0.04, 0.32),
    mirror: new THREE.BoxGeometry(0.27, 0.1, 0.18),
    louver: new THREE.BoxGeometry(0.94, 0.04, 0.17),
    fender: new THREE.BoxGeometry(0.32, 0.39, 1.0),
    splitter: new THREE.BoxGeometry(2.06, 0.08, 0.48),
    grille: new THREE.BoxGeometry(1.46, 0.21, 0.08),
    diffuser: new THREE.BoxGeometry(1.82, 0.23, 0.38),
    diffuserFin: new THREE.BoxGeometry(0.05, 0.25, 0.4),
    exhaust,
    wingBlade: new THREE.BoxGeometry(1.98, 0.075, 0.38),
    wingEndplate: new THREE.BoxGeometry(0.06, 0.3, 0.46),
    wingPylon: new THREE.BoxGeometry(0.07, 0.34, 0.24),
    headlight: new THREE.BoxGeometry(0.46, 0.09, 0.14),
    drlBlade: new THREE.BoxGeometry(0.54, 0.032, 0.16),
    tailBar: new THREE.BoxGeometry(1.76, 0.065, 0.08),
    tailPod: new THREE.BoxGeometry(0.38, 0.12, 0.09),
    rainLamp: new THREE.BoxGeometry(0.12, 0.14, 0.06),
    tire,
    rim,
    rotor,
    hubNut,
    spoke: new THREE.BoxGeometry(0.34, 0.45, 0.055),
    caliper: new THREE.BoxGeometry(0.18, 0.17, 0.12),
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
    mat.metalness = 0.22;
    mat.roughness = 0.22;
    mat.clearcoat = 0.92;
    mat.clearcoatRoughness = 0.1;
    mat.envMapIntensity = 0.82;
  } else if (finish === 'matte') {
    mat.metalness = 0.16;
    mat.roughness = 0.64;
    mat.clearcoat = 0.06;
    mat.clearcoatRoughness = 0.55;
    mat.envMapIntensity = 0.44;
  } else {
    // metallic flake showroom finish
    mat.metalness = 0.54;
    mat.roughness = 0.26;
    mat.clearcoat = 0.78;
    mat.clearcoatRoughness = 0.14;
    mat.envMapIntensity = 0.85;
  }
  mat.needsUpdate = true;
}

function applyRimFinish(mat: THREE.MeshStandardMaterial, finish: RimFinish): void {
  if (finish === 'gold') {
    mat.color.setHex(0xdcb45c);
    mat.metalness = 0.92;
    mat.roughness = 0.2;
  } else if (finish === 'obsidian') {
    mat.color.setHex(0x1f2530);
    mat.metalness = 0.78;
    mat.roughness = 0.26;
  } else if (finish === 'copper') {
    mat.color.setHex(0xc8744b);
    mat.metalness = 0.9;
    mat.roughness = 0.22;
  } else {
    mat.color.setHex(0xd8e1ec);
    mat.metalness = 0.94;
    mat.roughness = 0.16;
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
    metalness: 0.48,
    roughness: 0.28,
    clearcoat: 0.76,
    clearcoatRoughness: 0.15,
    envMapIntensity: 0.82,
  });
  if (opts.initialConfig) {
    applyPaintFinish(bodyMaterial, opts.initialConfig.paintFinish);
  }

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.accentColor),
    metalness: 0.42,
    roughness: 0.3,
    envMapIntensity: 0.75,
  });

  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x151a22,
    metalness: 0.22,
    roughness: 0.68,
    envMapIntensity: 0.55,
  });

  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x090f18,
    metalness: 0.18,
    roughness: 0.1,
    clearcoat: 0.95,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.95,
  });

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8e1ec,
    metalness: 0.94,
    roughness: 0.16,
    envMapIntensity: 1.0,
  });
  if (opts.initialConfig) {
    applyRimFinish(rimMaterial, opts.initialConfig.rimFinish);
  }

  const rotorMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b727d,
    emissive: 0xea580c,
    emissiveIntensity: 0.15,
    metalness: 0.76,
    roughness: 0.38,
  });

  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x14171c,
    metalness: 0.04,
    roughness: 0.9,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff9ea,
    emissive: 0xfff2cc,
    emissiveIntensity: 1.85,
    roughness: 0.12,
  });

  const tailLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2b2b,
    emissive: 0xf01e1e,
    emissiveIntensity: 1.45,
    roughness: 0.18,
  });

  const rainLampMaterial = new THREE.MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff2d20,
    emissiveIntensity: 1.2,
    roughness: 0.2,
  });

  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa834,
    transparent: true,
    opacity: 0.92,
  });

  const beamMaterial = new THREE.MeshBasicMaterial({
    map: opts.headlightBeamTex,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  // 1. Primary sculpted fuselage
  const bodyMesh = new THREE.Mesh(geos.body, bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);

  // 2. Sculpted fastback glass canopy + Roof Aero Intake Scoop + Twin Roof Strakes
  const canopyMesh = new THREE.Mesh(geos.canopy, canopyMaterial);
  canopyMesh.castShadow = true;
  bodyGroup.add(canopyMesh);

  const roofScoop = new THREE.Mesh(geos.roofScoop, carbonMaterial);
  roofScoop.position.set(0, 1.38, -0.35);
  bodyGroup.add(roofScoop);

  for (const rx of [-0.52, 0.52]) {
    const rail = new THREE.Mesh(geos.roofRail, accentMaterial);
    rail.position.set(rx, 1.32, -0.45);
    bodyGroup.add(rail);
  }

  // 3. Rear engine deck louvers (3 tiered carbon slats)
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(geos.louver, carbonMaterial);
    slat.position.set(0, 1.03 - i * 0.04, -1.24 - i * 0.22);
    slat.rotation.x = 0.2;
    bodyGroup.add(slat);
  }

  // 4. Sculpted carbon side skirts + recessed side aero cooling ducts + side mirrors
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(geos.sideSkirt, carbonMaterial);
    skirt.position.set(side * 1.01, 0.25, 0.02);
    bodyGroup.add(skirt);

    const intake = new THREE.Mesh(geos.sideIntake, carbonMaterial);
    intake.position.set(side * 0.96, 0.62, -0.52);
    bodyGroup.add(intake);

    const mirror = new THREE.Mesh(geos.mirror, bodyMaterial);
    mirror.position.set(side * 0.98, 0.97, 0.42);
    bodyGroup.add(mirror);

    // Front bumper carbon aero dive-plane canards
    const canard = new THREE.Mesh(geos.canard, carbonMaterial);
    canard.position.set(side * 0.99, 0.4, 2.02);
    canard.rotation.z = side * 0.22;
    bodyGroup.add(canard);
  }

  // 5. Rear dark carbon fascia panel
  const rearFascia = new THREE.Mesh(geos.grille, carbonMaterial);
  rearFascia.position.set(0, 0.72, -2.37);
  rearFascia.scale.set(1.24, 1.08, 1.0);
  bodyGroup.add(rearFascia);

  // 6. Wide muscular wheel-arch haunches (4)
  const fenderOffsets: Array<[number, number, number]> = [
    [-0.88, 0.56, 1.32],
    [0.88, 0.56, 1.32],
    [-0.92, 0.6, -1.28],
    [0.92, 0.6, -1.28],
  ];
  for (const [fx, fy, fz] of fenderOffsets) {
    const f = new THREE.Mesh(geos.fender, bodyMaterial);
    f.position.set(fx, fy, fz);
    f.castShadow = true;
    bodyGroup.add(f);
  }

  // 7. Front carbon aero splitter + intake grille + accent front splitter lip
  const splitter = new THREE.Mesh(geos.splitter, carbonMaterial);
  splitter.position.set(0, 0.24, 2.28);
  bodyGroup.add(splitter);

  const grille = new THREE.Mesh(geos.grille, carbonMaterial);
  grille.position.set(0, 0.44, 2.4);
  bodyGroup.add(grille);

  // 8. Rear diffuser + 4 vertical aero fins + F1 center rain lamp + twin exhausts + flames
  const diffuser = new THREE.Mesh(geos.diffuser, carbonMaterial);
  diffuser.position.set(0, 0.34, -2.32);
  bodyGroup.add(diffuser);

  for (const finX of [-0.66, -0.22, 0.22, 0.66]) {
    const fin = new THREE.Mesh(geos.diffuserFin, carbonMaterial);
    fin.position.set(finX, 0.3, -2.36);
    bodyGroup.add(fin);
  }

  const rainLamp = new THREE.Mesh(geos.rainLamp, rainLampMaterial);
  rainLamp.position.set(0, 0.36, -2.5);
  bodyGroup.add(rainLamp);

  const exhaustLeft = new THREE.Mesh(geos.exhaust, rimMaterial);
  exhaustLeft.position.set(-0.46, 0.35, -2.44);
  bodyGroup.add(exhaustLeft);

  const exhaustRight = new THREE.Mesh(geos.exhaust, rimMaterial);
  exhaustRight.position.set(0.46, 0.35, -2.44);
  bodyGroup.add(exhaustRight);

  const flameLeft = new THREE.Mesh(geos.flame, flameMaterial);
  flameLeft.position.set(-0.46, 0.35, -2.54);
  flameLeft.visible = false;
  bodyGroup.add(flameLeft);

  const flameRight = new THREE.Mesh(geos.flame, flameMaterial);
  flameRight.position.set(0.46, 0.35, -2.54);
  flameRight.visible = false;
  bodyGroup.add(flameRight);

  // 9. Sculpted twin-pylon GT rear wing + dual accent endplates
  const wingBlade = new THREE.Mesh(geos.wingBlade, carbonMaterial);
  wingBlade.position.set(0, 1.27, -2.08);
  wingBlade.rotation.x = 0.08;
  wingBlade.castShadow = true;
  bodyGroup.add(wingBlade);

  const endL = new THREE.Mesh(geos.wingEndplate, accentMaterial);
  endL.position.set(-0.99, 1.24, -2.08);
  bodyGroup.add(endL);

  const endR = new THREE.Mesh(geos.wingEndplate, accentMaterial);
  endR.position.set(0.99, 1.24, -2.08);
  bodyGroup.add(endR);

  const pylonL = new THREE.Mesh(geos.wingPylon, accentMaterial);
  pylonL.position.set(-0.56, 1.08, -2.02);
  bodyGroup.add(pylonL);

  const pylonR = new THREE.Mesh(geos.wingPylon, accentMaterial);
  pylonR.position.set(0.56, 1.08, -2.02);
  bodyGroup.add(pylonR);

  // 10. Signature LED Headlights + DRL Blades + Sculpted Quad-Element Tail Bar
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(geos.headlight, headlightMaterial);
    hl.position.set(side * 0.68, 0.62, 2.33);
    bodyGroup.add(hl);

    const drl = new THREE.Mesh(geos.drlBlade, headlightMaterial);
    drl.position.set(side * 0.69, 0.54, 2.35);
    drl.rotation.z = side * 0.12;
    bodyGroup.add(drl);

    const pod = new THREE.Mesh(geos.tailPod, tailLightMaterial);
    pod.position.set(side * 0.66, 0.76, -2.41);
    bodyGroup.add(pod);
  }

  const tailBar = new THREE.Mesh(geos.tailBar, tailLightMaterial);
  tailBar.position.set(0, 0.76, -2.41);
  bodyGroup.add(tailBar);

  // 11. Hood Livery Decal Plate & Side Door Number Roundels
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
    roughness: 0.3,
    metalness: 0.22,
    envMapIntensity: 0.68,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const hoodDecal = new THREE.Mesh(geos.hoodDecal, liveryMaterial);
  hoodDecal.position.set(0, 0.91, 1.3);
  hoodDecal.rotation.x = 0.14;
  bodyGroup.add(hoodDecal);

  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: doorTexture,
    transparent: true,
    roughness: 0.32,
    metalness: 0.18,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const doorL = new THREE.Mesh(geos.doorDecal, doorMaterial);
  doorL.position.set(-0.99, 0.62, 0.22);
  doorL.rotation.y = -Math.PI / 2;
  bodyGroup.add(doorL);

  const doorR = new THREE.Mesh(geos.doorDecal, doorMaterial);
  doorR.position.set(0.99, 0.62, 0.22);
  doorR.rotation.y = Math.PI / 2;
  bodyGroup.add(doorR);

  // 12. Four multi-part wheels (tire + alloy rim + center-lock nut + thermal brake rotor + spokes + caliper)
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
    const tireMesh = new THREE.Mesh(geos.tire, tireMaterial);
    tireMesh.castShadow = true;
    wheelAssembly.add(tireMesh);

    const rimMesh = new THREE.Mesh(geos.rim, rimMaterial);
    wheelAssembly.add(rimMesh);

    const rotorMesh = new THREE.Mesh(geos.rotor, rotorMaterial);
    wheelAssembly.add(rotorMesh);

    const nutMesh = new THREE.Mesh(geos.hubNut, accentMaterial);
    wheelAssembly.add(nutMesh);

    const spokeA = new THREE.Mesh(geos.spoke, rimMaterial);
    wheelAssembly.add(spokeA);
    const spokeB = new THREE.Mesh(geos.spoke, rimMaterial);
    spokeB.rotation.x = Math.PI / 3;
    wheelAssembly.add(spokeB);
    const spokeC = new THREE.Mesh(geos.spoke, rimMaterial);
    spokeC.rotation.x = (2 * Math.PI) / 3;
    wheelAssembly.add(spokeC);

    wheelSpinMeshes.push(wheelAssembly);

    if (wc.pivot) {
      wc.pivot.position.set(wc.x, 0.37, wc.z);
      const caliper = new THREE.Mesh(geos.caliper, accentMaterial);
      caliper.position.set(wc.x < 0 ? 0.08 : -0.08, 0.04, -0.14);
      wc.pivot.add(caliper);
      wc.pivot.add(wheelAssembly);
      root.add(wc.pivot);
    } else {
      const rearHub = new THREE.Group();
      rearHub.position.set(wc.x, 0.37, wc.z);
      const caliper = new THREE.Mesh(geos.caliper, accentMaterial);
      caliper.position.set(wc.x < 0 ? 0.08 : -0.08, 0.04, 0.14);
      rearHub.add(caliper);
      rearHub.add(wheelAssembly);
      root.add(rearHub);
    }
  }

  // 13. Soft road-projected headlight beam cones (vivid in Twilight & Glacier, subtle in Golden)
  const beamLeft = new THREE.Mesh(geos.headlightBeam, beamMaterial);
  beamLeft.position.set(-0.68, 0.07, 2.38);
  root.add(beamLeft);

  const beamRight = new THREE.Mesh(geos.headlightBeam, beamMaterial);
  beamRight.position.set(0.68, 0.07, 2.38);
  root.add(beamRight);

  // 14. Grounded radial contact shadow disc
  const shadowMat = new THREE.MeshBasicMaterial({
    map: opts.contactShadowTex,
    transparent: true,
    opacity: 0.68,
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
  };

  const setHeadlightBoost = (intensity: number, beamOpacity = 0.16) => {
    headlightMaterial.emissiveIntensity = intensity;
    beamMaterial.opacity = beamOpacity;
    const showBeams = beamOpacity > 0.03;
    beamLeft.visible = showBeams;
    beamRight.visible = showBeams;
  };

  const dispose = () => {
    bodyMaterial.dispose();
    accentMaterial.dispose();
    carbonMaterial.dispose();
    canopyMaterial.dispose();
    rimMaterial.dispose();
    rotorMaterial.dispose();
    tireMaterial.dispose();
    headlightMaterial.dispose();
    tailLightMaterial.dispose();
    rainLampMaterial.dispose();
    flameMaterial.dispose();
    beamMaterial.dispose();
    liveryMaterial.dispose();
    doorMaterial.dispose();
    shadowMat.dispose();
    if (liveryTexture) liveryTexture.dispose();
    if (doorTexture) doorTexture.dispose();
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
    beamMaterial,
    liveryTexture,
    doorTexture,
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

  // Suspension bounce, pitch & roll on sprung bodyGroup
  rig.bodyGroup.position.y = state.suspensionBounce;
  rig.bodyGroup.rotation.x = state.pitch;
  rig.bodyGroup.rotation.z = state.roll;

  // Keep contact shadow & headlight beams anchored on road surface during ramp jumps
  const altitude = Math.max(0, state.y - state.groundY);
  rig.shadowMesh.position.y = 0.048 - altitude;
  const shadowScale = Math.max(0.55, 1 - altitude * 0.055);
  rig.shadowMesh.scale.set(shadowScale, 1, shadowScale);
  rig.headlightBeams[0].position.y = 0.07 - altitude;
  rig.headlightBeams[1].position.y = 0.07 - altitude;

  // Front steering angle + 4 wheel rolling rotation
  rig.frontWheelPivots[0].rotation.y = state.steerAngle;
  rig.frontWheelPivots[1].rotation.y = state.steerAngle;
  for (const w of rig.wheelSpinMeshes) {
    w.rotation.x = state.wheelSpin;
  }

  const boosting = state.isBoosting || state.padBoostTimer > 0;
  rig.tailLightMaterial.emissiveIntensity = isBraking ? 3.8 : boosting ? 2.4 : 1.3;
  // Thermal rotor glow under heavy braking
  rig.rotorMaterial.emissiveIntensity = isBraking && Math.abs(state.speed) > 12 ? 1.85 : 0.14;
  // F1-style central rear rain/boost pulse strobe when boosting or braking
  const strobe = Math.sin(elapsedTime * 22) > 0 ? 2.6 : 0.6;
  rig.rainLampMaterial.emissiveIntensity = boosting || isBraking ? strobe : 0.7;

  // Dynamic exhaust boost flames
  for (const flame of rig.boostFlames) {
    flame.visible = boosting;
    if (boosting) {
      const mat = flame.material as THREE.MeshBasicMaterial;
      mat.color.setHex(state.padBoostTimer > 0 ? 0x38e8ff : 0xffaa30);
      const flicker = 0.85 + Math.sin(elapsedTime * 58) * 0.25;
      flame.scale.set(1, 1, flicker * 1.32);
    }
  }

  if (state.hitFlashTimer > 0) {
    rig.bodyMaterial.emissive.copy(_flashWhite);
    rig.bodyMaterial.emissiveIntensity = 0.55;
  } else {
    rig.bodyMaterial.emissive.setHex(0x000000);
    rig.bodyMaterial.emissiveIntensity = 0;
  }
}
