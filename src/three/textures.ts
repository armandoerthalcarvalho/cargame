import * as THREE from 'three';
import type { LiveryConfig } from '../game/types';

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface RoadTextureSet {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  curb: THREE.CanvasTexture;
  startGrid: THREE.CanvasTexture;
}

export interface TerrainDetailTextureSet {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

export function createRoadTextures(
  asphaltTint: string,
  curbPrimary: string,
  curbSecondary: string,
  maxAnisotropy: number,
): RoadTextureSet {
  // 1. High-resolution 1024x1024 weathered motorsport asphalt albedo texture
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(4219);

  ctx.fillStyle = asphaltTint;
  ctx.fillRect(0, 0, 1024, 1024);

  // Fine mineral aggregate speckle & stone flecks
  for (let i = 0; i < 22000; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const v = rand() > 0.48 ? 255 : 10;
    const a = 0.025 + rand() * 0.06;
    ctx.fillStyle = `rgba(${v},${v},${v},${a.toFixed(3)})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle longitudinal tarmac paving seams & hairline thermal cracks
  ctx.fillStyle = 'rgba(0,0,0,0.11)';
  ctx.fillRect(254, 0, 3, 1024);
  ctx.fillRect(768, 0, 3, 1024);

  ctx.strokeStyle = 'rgba(8,10,14,0.18)';
  ctx.lineWidth = 1.4;
  for (let c = 0; c < 14; c++) {
    let cx = 80 + rand() * 860;
    let cy = rand() * 1024;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 5; s++) {
      cx += (rand() - 0.5) * 32;
      cy += 16 + rand() * 28;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Subtle darker rubbered-in racing grooves in left & right lanes
  const gradLeft = ctx.createLinearGradient(165, 0, 425, 0);
  gradLeft.addColorStop(0, 'rgba(0,0,0,0)');
  gradLeft.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  gradLeft.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradLeft;
  ctx.fillRect(165, 0, 260, 1024);

  const gradRight = ctx.createLinearGradient(599, 0, 859, 0);
  gradRight.addColorStop(0, 'rgba(0,0,0,0)');
  gradRight.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  gradRight.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradRight;
  ctx.fillRect(599, 0, 260, 1024);

  // Subtle grooved rumble-strip notches along outer edges
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let y = 0; y < 1024; y += 32) {
    ctx.fillRect(6, y, 16, 10);
    ctx.fillRect(1002, y, 16, 10);
  }

  // Crisp painted shoulder edge lines
  ctx.fillStyle = 'rgba(246, 243, 236, 0.92)';
  ctx.fillRect(28, 0, 18, 1024);
  ctx.fillRect(978, 0, 18, 1024);

  // Twin-style dashed touring centerline with subtle wear
  ctx.fillStyle = 'rgba(248, 208, 118, 0.9)';
  ctx.fillRect(504, 56, 16, 368);
  ctx.fillRect(504, 568, 16, 368);

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = maxAnisotropy;

  // 2. Grayscale micro-relief bump texture (linear space)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 512, 512);
  const randB = seededRand(8831);
  for (let i = 0; i < 14000; i++) {
    const shade = Math.floor(64 + randB() * 136);
    bctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    bctx.fillRect(randB() * 512, randB() * 512, 2, 2);
  }
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = maxAnisotropy;

  // 3. Road roughness variation map (darker = smoother sheen in rubbered racing grooves)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 512;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#dcdcdc'; // matte aggregate baseline
  rctx.fillRect(0, 0, 512, 512);

  // Polished darker rubbered racing lanes catch golden sun reflections
  const rGradL = rctx.createLinearGradient(85, 0, 215, 0);
  rGradL.addColorStop(0, 'rgba(130,130,130,0)');
  rGradL.addColorStop(0.5, 'rgba(110,110,110,0.75)');
  rGradL.addColorStop(1, 'rgba(130,130,130,0)');
  rctx.fillStyle = rGradL;
  rctx.fillRect(85, 0, 130, 512);

  const rGradR = rctx.createLinearGradient(297, 0, 427, 0);
  rGradR.addColorStop(0, 'rgba(130,130,130,0)');
  rGradR.addColorStop(0.5, 'rgba(110,110,110,0.75)');
  rGradR.addColorStop(1, 'rgba(130,130,130,0)');
  rctx.fillStyle = rGradR;
  rctx.fillRect(297, 0, 130, 512);

  const randR = seededRand(5113);
  for (let i = 0; i < 6500; i++) {
    const shade = Math.floor(150 + randR() * 95);
    rctx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    rctx.fillRect(randR() * 512, randR() * 512, 3, 3);
  }
  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = THREE.RepeatWrapping;
  roughness.wrapT = THREE.RepeatWrapping;
  roughness.anisotropy = maxAnisotropy;

  // 4. Alternating motorsport curb texture with beveled groove shadows
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 128;
  curbCanvas.height = 256;
  const cctx = curbCanvas.getContext('2d')!;
  cctx.fillStyle = curbPrimary;
  cctx.fillRect(0, 0, 128, 128);
  cctx.fillStyle = curbSecondary;
  cctx.fillRect(0, 128, 128, 128);
  cctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (let y = 0; y < 256; y += 16) {
    cctx.fillRect(0, y, 128, 2.5);
  }
  cctx.fillStyle = 'rgba(255,255,255,0.12)';
  cctx.fillRect(0, 0, 10, 256);

  const curb = new THREE.CanvasTexture(curbCanvas);
  curb.colorSpace = THREE.SRGBColorSpace;
  curb.wrapS = THREE.RepeatWrapping;
  curb.wrapT = THREE.RepeatWrapping;
  curb.anisotropy = maxAnisotropy;

  // 5. Start/Finish checkered tarmac grid strip
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 512;
  gridCanvas.height = 128;
  const gctx = gridCanvas.getContext('2d')!;
  const cell = 32;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 16; c++) {
      gctx.fillStyle = (r + c) % 2 === 0 ? '#f4f0e6' : '#181c24';
      gctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  const startGrid = new THREE.CanvasTexture(gridCanvas);
  startGrid.colorSpace = THREE.SRGBColorSpace;
  startGrid.anisotropy = maxAnisotropy;

  return { albedo, bump, roughness, curb, startGrid };
}

export function createTerrainDetailTextures(maxAnisotropy: number): TerrainDetailTextureSet {
  // Neutral grayscale-warm geological rock strata & organic ground micro-detail multiplied over vertex colors
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(90421);

  ctx.fillStyle = '#e7e5e1';
  ctx.fillRect(0, 0, size, size);

  // Soft isotropic macro tonal patches (avoids unnatural horizontal striping on hills)
  for (let i = 0; i < 240; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 38;
    const bright = rand() > 0.5 ? 255 : 185;
    const alpha = 0.04 + rand() * 0.055;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${bright},${bright},${bright},${alpha.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${bright},${bright},${bright},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Organic multi-scale pebbles, scree, and vegetation dapples
  for (let i = 0; i < 5200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1.4 + rand() * 5.2;
    const bright = rand() > 0.45 ? 255 : 162;
    const alpha = 0.05 + rand() * 0.11;
    ctx.fillStyle = `rgba(${bright},${bright},${bright},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine crisp grit
  for (let i = 0; i < 12000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand() > 0.5 ? 255 : 135;
    ctx.fillStyle = `rgba(${v},${v},${v},0.08)`;
    ctx.fillRect(x, y, 2, 2);
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(36, 36);
  albedo.anisotropy = maxAnisotropy;

  // Matching isotropic linear bump map for sunlit ridge micro-relief
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  const randB = seededRand(3017);
  for (let i = 0; i < 180; i++) {
    const x = randB() * 256;
    const y = randB() * 256;
    const r = 8 + randB() * 20;
    const v = randB() > 0.5 ? 168 : 92;
    const g = bctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    bctx.fillStyle = g;
    bctx.beginPath();
    bctx.arc(x, y, r, 0, Math.PI * 2);
    bctx.fill();
  }
  for (let i = 0; i < 4200; i++) {
    const v = Math.floor(70 + randB() * 130);
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(randB() * 256, randB() * 256, 2, 2);
  }

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(44, 44);
  bump.anisotropy = maxAnisotropy;

  return { albedo, bump };
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  const grad = ctx.createRadialGradient(64, 128, 12, 64, 128, 62);
  grad.addColorStop(0, 'rgba(6, 8, 12, 0.92)');
  grad.addColorStop(0.55, 'rgba(6, 8, 12, 0.48)');
  grad.addColorStop(1, 'rgba(6, 8, 12, 0)');

  ctx.save();
  ctx.scale(1, 2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createHeadlightBeamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  const grad = ctx.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, 'rgba(255, 245, 214, 0.72)');
  grad.addColorStop(0.38, 'rgba(255, 242, 204, 0.34)');
  grad.addColorStop(0.78, 'rgba(255, 238, 194, 0.08)');
  grad.addColorStop(1, 'rgba(255, 238, 194, 0)');

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(46, 256);
  ctx.lineTo(82, 256);
  ctx.lineTo(124, 0);
  ctx.lineTo(4, 0);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStartBannerTexture(
  title: string,
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#111621';
  ctx.fillRect(0, 0, 1024, 128);

  const sq = 16;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f3efe6' : '#1b2028';
      ctx.fillRect(c * sq, r * sq, sq, sq);
      ctx.fillRect(1024 - (c + 1) * sq, r * sq, sq, sq);
    }
  }

  ctx.fillStyle = accentHex;
  ctx.fillRect(64, 0, 896, 8);
  ctx.fillRect(64, 120, 896, 8);

  ctx.fillStyle = '#f8f5ef';
  ctx.font = '800 50px Oxanium, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), 512, 66, 820);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createChevronSignTexture(
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#141822';
  ctx.fillRect(0, 0, 256, 128);

  // Subtle metallic frame border
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 120);

  // Bold twin motorsport directional chevrons
  ctx.fillStyle = accentHex;
  for (const ox of [54, 146]) {
    ctx.beginPath();
    ctx.moveTo(ox, 20);
    ctx.lineTo(ox + 42, 20);
    ctx.lineTo(ox + 76, 64);
    ctx.lineTo(ox + 42, 108);
    ctx.lineTo(ox, 108);
    ctx.lineTo(ox + 34, 64);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createTimingTowerTexture(
  courseName: string,
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0c1018';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 512, 12);
  ctx.fillRect(0, 244, 512, 12);

  ctx.fillStyle = '#f8f5ef';
  ctx.font = '800 32px Oxanium, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SOLSTICE GT', 28, 56);

  ctx.fillStyle = accentHex;
  ctx.font = '700 22px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('LIVE TIMING', 484, 54);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(28, 76, 456, 2);

  const rows = [
    ['01', 'YOU', 'GT-07'],
    ['02', 'VERA', 'APX-11'],
    ['03', 'KAI', 'DRF-42'],
    ['04', 'SORA', 'SLP-88'],
  ];
  ctx.font = '700 24px JetBrains Mono, monospace';
  rows.forEach(([pos, driver, tag], idx) => {
    const y = 114 + idx * 34;
    ctx.fillStyle = idx === 0 ? accentHex : '#9aa4b5';
    ctx.textAlign = 'left';
    ctx.fillText(pos, 32, y);
    ctx.fillStyle = '#f4f1ea';
    ctx.fillText(driver, 96, y);
    ctx.fillStyle = '#b9c4d6';
    ctx.textAlign = 'right';
    ctx.fillText(tag, 480, y);
  });

  ctx.fillStyle = '#7e8a9c';
  ctx.font = '600 16px Plus Jakarta Sans, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(courseName.toUpperCase(), 28, 232);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createDoorNumberTexture(
  racingNumber: string,
  accentColor: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);

  // Subtle racing stripe flash behind roundel
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 50, 256, 28);
  ctx.fillStyle = 'rgba(20,24,32,0.85)';
  ctx.fillRect(0, 78, 256, 8);

  // White motorsport number plate
  ctx.fillStyle = '#f8f5ef';
  ctx.beginPath();
  ctx.roundRect(68, 14, 120, 100, 14);
  ctx.fill();
  ctx.strokeStyle = '#141820';
  ctx.lineWidth = 6;
  ctx.stroke();

  const numText = (racingNumber || '07').slice(0, 2).toUpperCase();
  ctx.fillStyle = '#141820';
  ctx.font = '800 62px Oxanium, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numText, 128, 68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createLiveryTexture(
  config: LiveryConfig,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = config.bodyColor;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = config.accentColor;
  if (config.stripeStyle === 'twin') {
    ctx.fillRect(200, 0, 42, 512);
    ctx.fillRect(270, 0, 42, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fillRect(186, 0, 6, 512);
    ctx.fillRect(320, 0, 6, 512);
  } else if (config.stripeStyle === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(80, 0);
    ctx.lineTo(256, 224);
    ctx.lineTo(432, 0);
    ctx.lineTo(356, 0);
    ctx.lineTo(256, 130);
    ctx.lineTo(156, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(236, 140, 40, 372);
  } else if (config.stripeStyle === 'horizon') {
    ctx.fillRect(0, 168, 512, 56);
    ctx.fillStyle = '#151922';
    ctx.fillRect(0, 232, 512, 24);
    ctx.fillStyle = config.accentColor;
    ctx.fillRect(244, 0, 24, 512);
  } else if (config.stripeStyle === 'carbon') {
    ctx.fillStyle = '#141820';
    ctx.fillRect(128, 0, 256, 512);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 4;
    for (let i = -512; i < 1024; i += 16) {
      ctx.beginPath();
      ctx.moveTo(128, i);
      ctx.lineTo(384, i + 256);
      ctx.stroke();
    }
    ctx.fillStyle = config.accentColor;
    ctx.fillRect(116, 0, 12, 512);
    ctx.fillRect(384, 0, 12, 512);
  } else {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(298, 0);
    ctx.lineTo(196, 512);
    ctx.lineTo(0, 512);
    ctx.closePath();
    ctx.fill();
  }

  // Crisp motorsport number roundel
  ctx.fillStyle = '#f8f5ef';
  ctx.beginPath();
  ctx.arc(256, 290, 68, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#141820';
  ctx.lineWidth = 7;
  ctx.stroke();

  const numText = (config.racingNumber || '07').slice(0, 2).toUpperCase();
  ctx.fillStyle = '#141820';
  ctx.font = '800 58px Oxanium, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numText, 256, 294);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}
