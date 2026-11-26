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
  curb: THREE.CanvasTexture;
  startGrid: THREE.CanvasTexture;
}

export function createRoadTextures(
  asphaltTint: string,
  curbPrimary: string,
  curbSecondary: string,
  maxAnisotropy: number,
): RoadTextureSet {
  // 1. High-resolution 1024x1024 weathered asphalt albedo texture
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(4219);

  ctx.fillStyle = asphaltTint;
  ctx.fillRect(0, 0, 1024, 1024);

  // Fine mineral aggregate speckle & stone flecks
  for (let i = 0; i < 18000; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const v = rand() > 0.48 ? 255 : 12;
    const a = 0.025 + rand() * 0.055;
    ctx.fillStyle = `rgba(${v},${v},${v},${a.toFixed(3)})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Subtle longitudinal tarmac paving seams
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(254, 0, 3, 1024);
  ctx.fillRect(768, 0, 3, 1024);

  // Subtle darker rubbered-in racing grooves in left & right lanes
  const gradLeft = ctx.createLinearGradient(170, 0, 420, 0);
  gradLeft.addColorStop(0, 'rgba(0,0,0,0)');
  gradLeft.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  gradLeft.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradLeft;
  ctx.fillRect(170, 0, 250, 1024);

  const gradRight = ctx.createLinearGradient(604, 0, 854, 0);
  gradRight.addColorStop(0, 'rgba(0,0,0,0)');
  gradRight.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  gradRight.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradRight;
  ctx.fillRect(604, 0, 250, 1024);

  // Crisp painted shoulder edge lines
  ctx.fillStyle = 'rgba(246, 243, 236, 0.9)';
  ctx.fillRect(28, 0, 18, 1024);
  ctx.fillRect(978, 0, 18, 1024);

  // Twin-style dashed touring centerline
  ctx.fillStyle = 'rgba(248, 208, 118, 0.88)';
  ctx.fillRect(504, 60, 16, 360);
  ctx.fillRect(504, 572, 16, 360);

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = maxAnisotropy;

  // 2. Grayscale micro-relief bump/roughness texture (linear space)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 512, 512);
  const randB = seededRand(8831);
  for (let i = 0; i < 11000; i++) {
    const shade = Math.floor(72 + randB() * 124);
    bctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    bctx.fillRect(randB() * 512, randB() * 512, 2, 2);
  }
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = maxAnisotropy;

  // 3. Alternating motorsport curb texture
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 128;
  curbCanvas.height = 256;
  const cctx = curbCanvas.getContext('2d')!;
  cctx.fillStyle = curbPrimary;
  cctx.fillRect(0, 0, 128, 128);
  cctx.fillStyle = curbSecondary;
  cctx.fillRect(0, 128, 128, 128);
  cctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let y = 0; y < 256; y += 16) {
    cctx.fillRect(0, y, 128, 2);
  }

  const curb = new THREE.CanvasTexture(curbCanvas);
  curb.colorSpace = THREE.SRGBColorSpace;
  curb.wrapS = THREE.RepeatWrapping;
  curb.wrapT = THREE.RepeatWrapping;
  curb.anisotropy = maxAnisotropy;

  // 4. Start/Finish checkered tarmac grid strip
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

  return { albedo, bump, curb, startGrid };
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  const grad = ctx.createRadialGradient(64, 128, 14, 64, 128, 62);
  grad.addColorStop(0, 'rgba(6, 8, 12, 0.88)');
  grad.addColorStop(0.55, 'rgba(6, 8, 12, 0.45)');
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

  // Checkered motorsport endcaps (64px wide each side)
  const sq = 16;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f3efe6' : '#1b2028';
      ctx.fillRect(c * sq, r * sq, sq, sq);
      ctx.fillRect(1024 - (c + 1) * sq, r * sq, sq, sq);
    }
  }

  // Accent top and bottom trim bars
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
    // Diagonal woven motorsport carbon center panel with accent pinstripes
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
    // Split diagonal heritage stripe
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
