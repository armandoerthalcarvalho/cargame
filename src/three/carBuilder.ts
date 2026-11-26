import * as THREE from 'three';
import type { CarState, LiveryConfig, PaintFinish, RimFinish } from '../game/types';
import { createLiveryTexture } from './textures';

export interface CarMeshRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  bodyMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  rimMaterial: THREE.MeshStandardMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  tailLightMaterial: THREE.MeshStandardMaterial;
  liveryMaterial: THREE.MeshStandardMaterial;
  liveryTexture: THREE.CanvasTexture | null;
  frontWheelPivots: [THREE.Group, THREE.Group];
  wheelSpinMeshes: THREE.Object3D[];
  boostFlames: [THREE.Mesh, THREE.Mesh];
  shadowMesh: THREE.Mesh;
  baseBodyColor: THREE.Color;
  applyLivery: (config: LiveryConfig) => void;
  setHeadlightBoost: (intensity: number) => void;
  dispose: () => void;
}

function createBodyProfileGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-2.26, 0.34);
  shape.lineTo(2.3, 0.31); // lower sill
  shape.quadraticCurveTo(2.44, 0.44, 2.3, 0.64); // sculpted aerodynamic nose
  shape.lineTo(1.24, 0.83); // low sculpted hood
  shape.lineTo(0.45, 0.93); // cowl
  shape.lineTo(-1.38, 0.94); // rear deck
  shape.lineTo(-2.28, 0.88); // ducktail lip
  shape.lineTo(-2.32, 0.46); // rear diffuser cutoff
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
  shape.moveTo(-1.46, 0.86);
  shape.lineTo(0.88, 0.84);
  shape.quadraticCurveTo(0.3, 1.33, -0.18, 1.34);
  shape.lineTo(-0.92, 1.29);
  shape.quadraticCurveTo(-1.3, 1.12, -1.46, 0.86);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.26,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.08,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -0.63);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

let sharedGeos: {
  body: THREE.ExtrudeGeometry;
  canopy: THREE.ExtrudeGeometry;
  roofScoop: THREE.BoxGeometry;
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
  tailBar: THREE.BoxGeometry;
  tire: THREE.CylinderGeometry;
  rim: THREE.CylinderGeometry;
  rotor: THREE.CylinderGeometry;
  spoke: THREE.BoxGeometry;
  caliper: THREE.BoxGeometry;
  hoodDecal: THREE.PlaneGeometry;
  flame: THREE.ConeGeometry;
  shadowPlane: THREE.PlaneGeometry;
} | null = null;

function getSharedCarGeometries() {
  if (sharedGeos) return sharedGeos;

  const tire = new THREE.CylinderGeometry(0.37, 0.37, 0.31, 20);
  tire.rotateZ(Math.PI / 2);

  const rim = new THREE.CylinderGeometry(0.255, 0.255, 0.325, 16);
  rim.rotateZ(Math.PI / 2);

  const rotor = new THREE.CylinderGeometry(0.19, 0.19, 0.33, 14);
  rotor.rotateZ(Math.PI / 2);

  const exhaust = new THREE.CylinderGeometry(0.068, 0.078, 0.3, 10);
  exhaust.rotateX(Math.PI / 2);

  const flame = new THREE.ConeGeometry(0.13, 1.05, 8);
  flame.rotateX(-Math.PI / 2);
  flame.translate(0, 0, -0.5);

  const shadowPlane = new THREE.PlaneGeometry(2.75, 5.35);
  shadowPlane.rotateX(-Math.PI / 2);

  const hoodDecal = new THREE.PlaneGeometry(1.38, 1.42);
  hoodDecal.rotateX(-Math.PI / 2);

  sharedGeos = {
    body: createBodyProfileGeometry(),
    canopy: createCanopyGeometry(),
    roofScoop: new THREE.BoxGeometry(0.36, 0.13, 0.72),
    mirror: new THREE.BoxGeometry(0.26, 0.1, 0.17),
    louver: new THREE.BoxGeometry(0.92, 0.04, 0.16),
    fender: new THREE.BoxGeometry(0.3, 0.38, 0.98),
    splitter: new THREE.BoxGeometry(2.02, 0.08, 0.46),
    grille: new THREE.BoxGeometry(1.42, 0.2, 0.08),
    diffuser: new THREE.BoxGeometry(1.78, 0.22, 0.36),
    diffuserFin: new THREE.BoxGeometry(0.05, 0.24, 0.38),
    exhaust,
    wingBlade: new THREE.BoxGeometry(1.94, 0.07, 0.36),
    wingEndplate: new THREE.BoxGeometry(0.06, 0.28, 0.44),
    wingPylon: new THREE.BoxGeometry(0.07, 0.32, 0.24),
    headlight: new THREE.BoxGeometry(0.46, 0.09, 0.14),
    tailBar: new THREE.BoxGeometry(1.74, 0.09, 0.08),
    tire,
    rim,
    rotor,
    spoke: new THREE.BoxGeometry(0.335, 0.44, 0.055),
    caliper: new THREE.BoxGeometry(0.18, 0.17, 0.12),
    hoodDecal,
    flame,
    shadowPlane,
  };
  return sharedGeos;
}

function applyPaintFinish(mat: THREE.MeshPhysicalMaterial, finish: PaintFinish): void {
  if (finish === 'gloss') {
    mat.metalness = 0.2;
    mat.roughness = 0.26;
    mat.clearcoat = 0.78;
    mat.clearcoatRoughness = 0.14;
    mat.envMapIntensity = 0.68;
  } else if (finish === 'matte') {
    mat.metalness = 0.14;
    mat.roughness = 0.64;
    mat.clearcoat = 0.06;
    mat.clearcoatRoughness = 0.55;
    mat.envMapIntensity = 0.42;
  } else {
    // metallic
    mat.metalness = 0.48;
    mat.roughness = 0.3;
    mat.clearcoat = 0.6;
    mat.clearcoatRoughness = 0.2;
    mat.envMapIntensity = 0.66;
  }
  mat.needsUpdate = true;
}

function applyRimFinish(mat: THREE.MeshStandardMaterial, finish: RimFinish): void {
  if (finish === 'gold') {
    mat.color.setHex(0xdcb45c);
    mat.metalness = 0.9;
    mat.roughness = 0.22;
  } else if (finish === 'obsidian') {
    mat.color.setHex(0x1f2530);
    mat.metalness = 0.75;
    mat.roughness = 0.28;
  } else if (finish === 'copper') {
    mat.color.setHex(0xc8744b);
    mat.metalness = 0.88;
    mat.roughness = 0.24;
  } else {
    mat.color.setHex(0xd8e1ec);
    mat.metalness = 0.92;
    mat.roughness = 0.18;
  }
  mat.needsUpdate = true;
}

export function buildCompositeCar(opts: {
  bodyColor: string;
  accentColor: string;
  contactShadowTex: THREE.CanvasTexture;
  maxAnisotropy: number;
  initialConfig?: LiveryConfig;
}): CarMeshRig {
  const geos = getSharedCarGeometries();
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const baseBodyColor = new THREE.Color(opts.bodyColor);

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: baseBodyColor.clone(),
    metalness: 0.42,
    roughness: 0.32,
    clearcoat: 0.58,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.64,
  });
  if (opts.initialConfig) {
    applyPaintFinish(bodyMaterial, opts.initialConfig.paintFinish);
  }

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.accentColor),
    metalness: 0.38,
    roughness: 0.34,
    envMapIntensity: 0.68,
  });

  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x161b23,
    metalness: 0.18,
    roughness: 0.74,
    envMapIntensity: 0.5,
  });

  const canopyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0a1019,
    metalness: 0.14,
    roughness: 0.16,
    clearcoat: 0.65,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.56,
  });

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8e1ec,
    metalness: 0.92,
    roughness: 0.18,
    envMapIntensity: 0.9,
  });
  if (opts.initialConfig) {
    applyRimFinish(rimMaterial, opts.initialConfig.rimFinish);
  }

  const rotorMaterial = new THREE.MeshStandardMaterial({
    color: 0x646b75,
    emissive: 0xd9480f,
    emissiveIntensity: 0.2,
    metalness: 0.72,
    roughness: 0.42,
  });

  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x15171c,
    metalness: 0.04,
    roughness: 0.9,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8e6,
    emissive: 0xfff0c4,
    emissiveIntensity: 1.7,
    roughness: 0.14,
  });

  const tailLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2b2b,
    emissive: 0xe61c1c,
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });

  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa834,
    transparent: true,
    opacity: 0.9,
  });

  // 1. Primary sculpted fuselage
  const bodyMesh = new THREE.Mesh(geos.body, bodyMaterial);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);

  // 2. Sculpted fastback glass canopy + Roof Aero Intake Scoop
  const canopyMesh = new THREE.Mesh(geos.canopy, canopyMaterial);
  canopyMesh.castShadow = true;
  bodyGroup.add(canopyMesh);

  const roofScoop = new THREE.Mesh(geos.roofScoop, carbonMaterial);
  roofScoop.position.set(0, 1.36, -0.35);
  bodyGroup.add(roofScoop);

  // 3. Rear engine deck louvers (3 tiered slats)
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(geos.louver, carbonMaterial);
    slat.position.set(0, 1.02 - i * 0.04, -1.24 - i * 0.22);
    slat.rotation.x = 0.2;
    bodyGroup.add(slat);
  }

  // 4. Aerodynamic side mirrors
  const mirrorL = new THREE.Mesh(geos.mirror, bodyMaterial);
  mirrorL.position.set(-0.98, 0.96, 0.42);
  bodyGroup.add(mirrorL);
  const mirrorR = new THREE.Mesh(geos.mirror, bodyMaterial);
  mirrorR.position.set(0.98, 0.96, 0.42);
  bodyGroup.add(mirrorR);

  // 5. Rear dark carbon fascia panel
  const rearFascia = new THREE.Mesh(geos.grille, carbonMaterial);
  rearFascia.position.set(0, 0.72, -2.35);
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

  // 7. Front carbon aero splitter + intake grille
  const splitter = new THREE.Mesh(geos.splitter, carbonMaterial);
  splitter.position.set(0, 0.25, 2.26);
  bodyGroup.add(splitter);

  const grille = new THREE.Mesh(geos.grille, carbonMaterial);
  grille.position.set(0, 0.44, 2.38);
  bodyGroup.add(grille);

  // 8. Rear diffuser + 4 vertical aero fins + twin metallic exhausts + boost flames
  const diffuser = new THREE.Mesh(geos.diffuser, carbonMaterial);
  diffuser.position.set(0, 0.34, -2.3);
  bodyGroup.add(diffuser);

  for (const finX of [-0.66, -0.22, 0.22, 0.66]) {
    const fin = new THREE.Mesh(geos.diffuserFin, carbonMaterial);
    fin.position.set(finX, 0.3, -2.34);
    bodyGroup.add(fin);
  }

  const exhaustLeft = new THREE.Mesh(geos.exhaust, rimMaterial);
  exhaustLeft.position.set(-0.46, 0.35, -2.42);
  bodyGroup.add(exhaustLeft);

  const exhaustRight = new THREE.Mesh(geos.exhaust, rimMaterial);
  exhaustRight.position.set(0.46, 0.35, -2.42);
  bodyGroup.add(exhaustRight);

  const flameLeft = new THREE.Mesh(geos.flame, flameMaterial);
  flameLeft.position.set(-0.46, 0.35, -2.52);
  flameLeft.visible = false;
  bodyGroup.add(flameLeft);

  const flameRight = new THREE.Mesh(geos.flame, flameMaterial);
  flameRight.position.set(0.46, 0.35, -2.52);
  flameRight.visible = false;
  bodyGroup.add(flameRight);

  // 9. Sculpted twin-pylon GT rear wing + dual accent endplates
  const wingBlade = new THREE.Mesh(geos.wingBlade, carbonMaterial);
  wingBlade.position.set(0, 1.25, -2.06);
  wingBlade.rotation.x = 0.08;
  wingBlade.castShadow = true;
  bodyGroup.add(wingBlade);

  const endL = new THREE.Mesh(geos.wingEndplate, accentMaterial);
  endL.position.set(-0.97, 1.22, -2.06);
  bodyGroup.add(endL);

  const endR = new THREE.Mesh(geos.wingEndplate, accentMaterial);
  endR.position.set(0.97, 1.22, -2.06);
  bodyGroup.add(endR);

  const pylonL = new THREE.Mesh(geos.wingPylon, accentMaterial);
  pylonL.position.set(-0.56, 1.07, -2.0);
  bodyGroup.add(pylonL);

  const pylonR = new THREE.Mesh(geos.wingPylon, accentMaterial);
  pylonR.position.set(0.56, 1.07, -2.0);
  bodyGroup.add(pylonR);

  // 10. LED Headlights + Full-width reactive brake tail-bar
  const hlLeft = new THREE.Mesh(geos.headlight, headlightMaterial);
  hlLeft.position.set(-0.68, 0.62, 2.31);
  bodyGroup.add(hlLeft);

  const hlRight = new THREE.Mesh(geos.headlight, headlightMaterial);
  hlRight.position.set(0.68, 0.62, 2.31);
  bodyGroup.add(hlRight);

  const tailBar = new THREE.Mesh(geos.tailBar, tailLightMaterial);
  tailBar.position.set(0, 0.75, -2.39);
  bodyGroup.add(tailBar);

  // 11. Hood Livery Decal Plate
  let liveryTexture: THREE.CanvasTexture | null = opts.initialConfig
    ? createLiveryTexture(opts.initialConfig, opts.maxAnisotropy)
    : null;

  const liveryMaterial = new THREE.MeshStandardMaterial({
    color: liveryTexture ? 0xffffff : new THREE.Color(opts.accentColor),
    map: liveryTexture,
    roughness: 0.34,
    metalness: 0.2,
    envMapIntensity: 0.58,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const hoodDecal = new THREE.Mesh(geos.hoodDecal, liveryMaterial);
  hoodDecal.position.set(0, 0.9, 1.3);
  hoodDecal.rotation.x = 0.14;
  bodyGroup.add(hoodDecal);

  // 12. Four multi-part wheels (tire + alloy rim + brake rotor + crossed spokes + accent caliper)
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

  // 13. Grounded radial contact shadow disc
  const shadowMat = new THREE.MeshBasicMaterial({
    map: opts.contactShadowTex,
    transparent: true,
    opacity: 0.64,
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
    if (liveryTexture) {
      liveryTexture.dispose();
    }
    liveryTexture = createLiveryTexture(config, opts.maxAnisotropy);
    liveryMaterial.map = liveryTexture;
    liveryMaterial.color.setHex(0xffffff);
    liveryMaterial.needsUpdate = true;
  };

  const setHeadlightBoost = (intensity: number) => {
    headlightMaterial.emissiveIntensity = intensity;
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
    flameMaterial.dispose();
    liveryMaterial.dispose();
    shadowMat.dispose();
    if (liveryTexture) liveryTexture.dispose();
  };

  return {
    root,
    bodyGroup,
    bodyMaterial,
    accentMaterial,
    rimMaterial,
    headlightMaterial,
    tailLightMaterial,
    liveryMaterial,
    liveryTexture,
    frontWheelPivots: [frontLeftPivot, frontRightPivot],
    wheelSpinMeshes,
    boostFlames: [flameLeft, flameRight],
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

  // Keep contact shadow anchored on road surface below car during ramp jumps!
  const altitude = Math.max(0, state.y - state.groundY);
  rig.shadowMesh.position.y = 0.048 - altitude;
  const shadowScale = Math.max(0.55, 1 - altitude * 0.055);
  rig.shadowMesh.scale.set(shadowScale, 1, shadowScale);

  // Front steering angle + 4 wheel rolling rotation
  rig.frontWheelPivots[0].rotation.y = state.steerAngle;
  rig.frontWheelPivots[1].rotation.y = state.steerAngle;
  for (const w of rig.wheelSpinMeshes) {
    w.rotation.x = state.wheelSpin;
  }

  const boosting = state.isBoosting || state.padBoostTimer > 0;
  rig.tailLightMaterial.emissiveIntensity = isBraking ? 3.5 : boosting ? 2.2 : 1.15;

  // Dynamic exhaust boost flames (cyan-gold tint on turbo pads, amber on overdrive)
  for (const flame of rig.boostFlames) {
    flame.visible = boosting;
    if (boosting) {
      const mat = flame.material as THREE.MeshBasicMaterial;
      mat.color.setHex(state.padBoostTimer > 0 ? 0x38e8ff : 0xffaa30);
      const flicker = 0.85 + Math.sin(elapsedTime * 58) * 0.25;
      flame.scale.set(1, 1, flicker * 1.28);
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
