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
  gravel: THREE.CanvasTexture;
}

export interface TerrainDetailTextureSet {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

export interface FoliageTextureSet {
  barkAlbedo: THREE.CanvasTexture;
  barkBump: THREE.CanvasTexture;
  leafAlbedo: THREE.CanvasTexture;
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

  // Subtle asphalt patching & tonal variation across paving strips
  for (let i = 0; i < 42; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const w = 60 + rand() * 180;
    const h = 90 + rand() * 260;
    const v = rand() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},0.024)`;
    ctx.fillRect(x, y, w, h);
  }

  // Dense multi-scale mineral aggregate granite & quartz flecks
  for (let i = 0; i < 34000; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const v = rand() > 0.52 ? 235 : 8;
    const a = 0.025 + rand() * 0.068;
    const sz = rand() > 0.82 ? 3 : 2;
    ctx.fillStyle = `rgba(${v},${v},${v},${a.toFixed(3)})`;
    ctx.fillRect(x, y, sz, sz);
  }

  // Longitudinal asphalt paver joints + tar-sealed expansion seams
  ctx.fillStyle = 'rgba(4,6,10,0.22)';
  ctx.fillRect(252, 0, 4, 1024);
  ctx.fillRect(766, 0, 4, 1024);
  ctx.fillStyle = 'rgba(4,6,10,0.14)';
  ctx.fillRect(0, 510, 1024, 3);

  // Realistic tar-sealed alligator & thermal cracks
  ctx.strokeStyle = 'rgba(6,8,12,0.34)';
  ctx.lineWidth = 2.0;
  for (let c = 0; c < 18; c++) {
    let cx = 75 + rand() * 874;
    let cy = rand() * 1024;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let s = 0; s < 6; s++) {
      cx += (rand() - 0.5) * 34;
      cy += 14 + rand() * 26;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // Dark rubbered-in twin racing tire grooves & subtle center oil track
  const drawLaneWear = (x0: number, w: number, peakAlpha: number) => {
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, `rgba(4,5,8,${peakAlpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, w, 1024);
  };
  drawLaneWear(150, 115, 0.24);
  drawLaneWear(310, 115, 0.22);
  drawLaneWear(599, 115, 0.22);
  drawLaneWear(759, 115, 0.24);

  // Subtle dark tire-scrub streaks along the racing groove
  ctx.fillStyle = 'rgba(5,6,9,0.08)';
  for (let s = 0; s < 26; s++) {
    const sx = (rand() > 0.5 ? 200 : 650) + rand() * 165;
    const sy = rand() * 1024;
    ctx.fillRect(sx, sy, 6 + rand() * 8, 55 + rand() * 120);
  }

  // Machined rumble-strip notches along outer asphalt edges
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 1024; y += 28) {
    ctx.fillRect(5, y, 17, 10);
    ctx.fillRect(1002, y, 17, 10);
  }

  // Crisp weathered white shoulder boundary lines
  ctx.fillStyle = 'rgba(232, 229, 222, 0.86)';
  ctx.fillRect(28, 0, 16, 1024);
  ctx.fillRect(980, 0, 16, 1024);

  // Weathered painted dashed touring centerline
  ctx.fillStyle = 'rgba(226, 184, 96, 0.84)';
  ctx.fillRect(505, 56, 14, 368);
  ctx.fillRect(505, 568, 14, 368);

  // Micro-wear flecks over paint so markings sit naturally inside the asphalt grain
  for (let i = 0; i < 1600; i++) {
    const py = rand() * 1024;
    ctx.fillStyle = asphaltTint;
    ctx.fillRect(504 + rand() * 16, py, 2, 2);
    ctx.fillRect((rand() > 0.5 ? 28 : 980) + rand() * 16, py, 2, 2);
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = maxAnisotropy;

  // 2. Crisp micro-aggregate bump map (linear space)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 512, 512);
  const randB = seededRand(8831);
  for (let i = 0; i < 22000; i++) {
    const shade = Math.floor(54 + randB() * 148);
    bctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    bctx.fillRect(randB() * 512, randB() * 512, 2, 2);
  }
  bctx.fillStyle = '#383838';
  bctx.fillRect(126, 0, 2, 512);
  bctx.fillRect(383, 0, 2, 512);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = maxAnisotropy;

  // 3. Matte-calibrated asphalt roughness map (zero blinding glare; subtle tire-track sheen only)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 512;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#ebebeb'; // matte dry aggregate baseline (~0.92 roughness)
  rctx.fillRect(0, 0, 512, 512);

  const rGradL = rctx.createLinearGradient(85, 0, 215, 0);
  rGradL.addColorStop(0, 'rgba(198,198,198,0)');
  rGradL.addColorStop(0.5, 'rgba(182,182,182,0.55)');
  rGradL.addColorStop(1, 'rgba(198,198,198,0)');
  rctx.fillStyle = rGradL;
  rctx.fillRect(85, 0, 130, 512);

  const rGradR = rctx.createLinearGradient(297, 0, 427, 0);
  rGradR.addColorStop(0, 'rgba(198,198,198,0)');
  rGradR.addColorStop(0.5, 'rgba(182,182,182,0.55)');
  rGradR.addColorStop(1, 'rgba(198,198,198,0)');
  rctx.fillStyle = rGradR;
  rctx.fillRect(297, 0, 130, 512);

  const randR = seededRand(5113);
  for (let i = 0; i < 8000; i++) {
    const shade = Math.floor(195 + randR() * 55);
    rctx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    rctx.fillRect(randR() * 512, randR() * 512, 2, 2);
  }
  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.wrapS = THREE.RepeatWrapping;
  roughness.wrapT = THREE.RepeatWrapping;
  roughness.anisotropy = maxAnisotropy;

  // 4. Sculpted beveled motorsport curb texture with expansion joints & tire scuffing
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 128;
  curbCanvas.height = 256;
  const cctx = curbCanvas.getContext('2d')!;
  cctx.fillStyle = curbPrimary;
  cctx.fillRect(0, 0, 128, 128);
  cctx.fillStyle = curbSecondary;
  cctx.fillRect(0, 128, 128, 128);
  // Sawtooth drainage grooves + concrete seam shadow
  cctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 256; y += 16) {
    cctx.fillRect(0, y, 128, 3);
  }
  cctx.fillStyle = 'rgba(0,0,0,0.18)';
  cctx.fillRect(0, 0, 10, 256);
  cctx.fillRect(118, 0, 10, 256);
  // Tire rubber scuff marks near inner edge
  const randC = seededRand(2049);
  for (let i = 0; i < 400; i++) {
    cctx.fillStyle = `rgba(18,20,24,${(0.06 + randC() * 0.14).toFixed(2)})`;
    cctx.fillRect(randC() * 56, randC() * 256, 3, 7);
  }

  const curb = new THREE.CanvasTexture(curbCanvas);
  curb.colorSpace = THREE.SRGBColorSpace;
  curb.wrapS = THREE.RepeatWrapping;
  curb.wrapT = THREE.RepeatWrapping;
  curb.anisotropy = maxAnisotropy;

  // 5. Weathered Start/Finish checkered tarmac grid strip
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 512;
  gridCanvas.height = 128;
  const gctx = gridCanvas.getContext('2d')!;
  const cell = 32;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 16; c++) {
      gctx.fillStyle = (r + c) % 2 === 0 ? '#dbd6cc' : '#1b1f27';
      gctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  const randG = seededRand(1109);
  for (let i = 0; i < 1600; i++) {
    gctx.fillStyle = `rgba(20,22,26,${(0.06 + randG() * 0.14).toFixed(2)})`;
    gctx.fillRect(randG() * 512, randG() * 128, 2, 3);
  }
  const startGrid = new THREE.CanvasTexture(gridCanvas);
  startGrid.colorSpace = THREE.SRGBColorSpace;
  startGrid.anisotropy = maxAnisotropy;

  // 6. Raked gravel runoff shoulder texture
  const gravCanvas = document.createElement('canvas');
  gravCanvas.width = 256;
  gravCanvas.height = 256;
  const grctx = gravCanvas.getContext('2d')!;
  grctx.fillStyle = '#c8c2b8';
  grctx.fillRect(0, 0, 256, 256);
  const randGr = seededRand(7741);
  // Subtle raked gravel trap grooves
  for (let x = 0; x < 256; x += 8) {
    grctx.fillStyle = x % 16 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    grctx.fillRect(x, 0, 4, 256);
  }
  for (let i = 0; i < 6500; i++) {
    const v = Math.floor(135 + randGr() * 95);
    grctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    grctx.fillRect(randGr() * 256, randGr() * 256, 2, 2);
  }
  const gravel = new THREE.CanvasTexture(gravCanvas);
  gravel.colorSpace = THREE.SRGBColorSpace;
  gravel.wrapS = THREE.RepeatWrapping;
  gravel.wrapT = THREE.RepeatWrapping;
  gravel.anisotropy = maxAnisotropy;

  return { albedo, bump, roughness, curb, startGrid, gravel };
}

export function createTerrainDetailTextures(maxAnisotropy: number): TerrainDetailTextureSet {
  // Neutral isotropic rock fracture, scree & organic soil micro-detail multiplied over vertex colors
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(90421);

  ctx.fillStyle = '#dfdfdb';
  ctx.fillRect(0, 0, size, size);

  // Soft isotropic macro tonal patches (earth, lichen, scree)
  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 34;
    const bright = rand() > 0.5 ? 245 : 168;
    const alpha = 0.05 + rand() * 0.07;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${bright},${bright},${bright},${alpha.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${bright},${bright},${bright},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Craggy rock fissure lines for realistic mountain cliff texture
  ctx.strokeStyle = 'rgba(70,68,64,0.16)';
  ctx.lineWidth = 1.6;
  for (let f = 0; f < 45; f++) {
    let fx = rand() * size;
    let fy = rand() * size;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    const angle = rand() * Math.PI * 2;
    for (let s = 0; s < 5; s++) {
      fx += Math.cos(angle + (rand() - 0.5) * 1.1) * (10 + rand() * 14);
      fy += Math.sin(angle + (rand() - 0.5) * 1.1) * (10 + rand() * 14);
      ctx.lineTo(fx, fy);
    }
    ctx.stroke();
  }

  // Multi-scale pebbles, scree, and organic vegetation dapples
  for (let i = 0; i < 7200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1.2 + rand() * 4.6;
    const bright = rand() > 0.45 ? 248 : 146;
    const alpha = 0.06 + rand() * 0.12;
    ctx.fillStyle = `rgba(${bright},${bright},${bright},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine mineral soil grit
  for (let i = 0; i < 16000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand() > 0.5 ? 250 : 120;
    ctx.fillStyle = `rgba(${v},${v},${v},0.09)`;
    ctx.fillRect(x, y, 2, 2);
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(42, 42);
  albedo.anisotropy = maxAnisotropy;

  // Matching isotropic high-contrast linear bump map for sunlit ridge & crag relief
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  const randB = seededRand(3017);
  for (let i = 0; i < 240; i++) {
    const x = randB() * 256;
    const y = randB() * 256;
    const r = 6 + randB() * 18;
    const v = randB() > 0.5 ? 186 : 74;
    const g = bctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},0.42)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    bctx.fillStyle = g;
    bctx.beginPath();
    bctx.arc(x, y, r, 0, Math.PI * 2);
    bctx.fill();
  }
  for (let i = 0; i < 6200; i++) {
    const v = Math.floor(55 + randB() * 155);
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(randB() * 256, randB() * 256, 2, 2);
  }

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(48, 48);
  bump.anisotropy = maxAnisotropy;

  return { albedo, bump };
}

export function createFoliageTextures(maxAnisotropy: number): FoliageTextureSet {
  // 1. Vertical furrowed tree bark albedo + bump
  const barkC = document.createElement('canvas');
  barkC.width = 256;
  barkC.height = 256;
  const bctx = barkC.getContext('2d')!;
  const rand = seededRand(6421);
  bctx.fillStyle = '#4c3728';
  bctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 4) {
    const shade = 48 + Math.floor(rand() * 44);
    bctx.fillStyle = `rgb(${shade + 16},${shade + 4},${shade - 6})`;
    bctx.fillRect(x, 0, 3 + rand() * 3, 256);
  }
  for (let i = 0; i < 2400; i++) {
    const v = rand() > 0.5 ? 25 : 95;
    bctx.fillStyle = `rgba(${v},${Math.floor(v * 0.8)},${Math.floor(v * 0.6)},0.25)`;
    bctx.fillRect(rand() * 256, rand() * 256, 2, 10 + rand() * 18);
  }
  const barkAlbedo = new THREE.CanvasTexture(barkC);
  barkAlbedo.colorSpace = THREE.SRGBColorSpace;
  barkAlbedo.wrapS = THREE.RepeatWrapping;
  barkAlbedo.wrapT = THREE.RepeatWrapping;
  barkAlbedo.anisotropy = maxAnisotropy;

  const barkBump = new THREE.CanvasTexture(barkC);
  barkBump.wrapS = THREE.RepeatWrapping;
  barkBump.wrapT = THREE.RepeatWrapping;

  // 2. Neutral dappled organic leaf / needle / blossom micro-texture (tinted by vertex/instance color)
  const leafC = document.createElement('canvas');
  leafC.width = 256;
  leafC.height = 256;
  const lctx = leafC.getContext('2d')!;
  const randL = seededRand(8817);
  lctx.fillStyle = '#c8c8c8';
  lctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const x = randL() * 256;
    const y = randL() * 256;
    const rx = 3 + randL() * 6;
    const ry = 1.5 + randL() * 3.5;
    const ang = randL() * Math.PI;
    const v = Math.floor(148 + randL() * 107);
    lctx.save();
    lctx.translate(x, y);
    lctx.rotate(ang);
    lctx.fillStyle = `rgba(${v},${v},${v},0.42)`;
    lctx.beginPath();
    lctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    lctx.fill();
    lctx.restore();
  }
  const leafAlbedo = new THREE.CanvasTexture(leafC);
  leafAlbedo.colorSpace = THREE.SRGBColorSpace;
  leafAlbedo.wrapS = THREE.RepeatWrapping;
  leafAlbedo.wrapT = THREE.RepeatWrapping;
  leafAlbedo.repeat.set(2, 2);
  leafAlbedo.anisotropy = maxAnisotropy;

  return { barkAlbedo, barkBump, leafAlbedo };
}

export function createHoneycombGrilleTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#090b0f';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#262d38';
  ctx.lineWidth = 2.2;
  const stepX = 16;
  const stepY = 14;
  for (let row = -1; row < 12; row++) {
    for (let col = -1; col < 18; col++) {
      const cx = col * stepX + (row % 2 === 0 ? 0 : stepX * 0.5);
      const cy = row * stepY;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(a) * 7.2;
        const py = cy + Math.sin(a) * 7.2;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createLicensePlateTexture(
  racingNumber: string,
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e8e4da';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#183b7a';
  ctx.fillRect(0, 0, 34, 64);
  ctx.fillStyle = accentHex;
  ctx.fillRect(34, 0, 6, 64);
  ctx.strokeStyle = '#181c22';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);

  const num = (racingNumber || '07').slice(0, 2).toUpperCase();
  ctx.fillStyle = '#141820';
  ctx.font = '800 34px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`SL-${num} GT`, 146, 34);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createBrakingSignTexture(
  meters: 150 | 100 | 50,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e5e2da';
  ctx.fillRect(0, 0, 256, 192);

  // Outer galvanized border + red motorsport header bar
  ctx.strokeStyle = '#1a1e26';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 182);

  ctx.fillStyle = meters === 50 ? '#b91c1c' : '#181e28';
  ctx.fillRect(10, 10, 236, 36);

  // Diagonal countdown stripes (3 bars = 150m, 2 bars = 100m, 1 bar = 50m)
  const bars = meters === 150 ? 3 : meters === 100 ? 2 : 1;
  ctx.fillStyle = '#e5e2da';
  for (let b = 0; b < bars; b++) {
    ctx.fillRect(28 + b * 28, 17, 16, 22);
  }

  ctx.fillStyle = '#12161e';
  ctx.font = '800 92px Oxanium, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${meters}`, 128, 114);

  ctx.fillStyle = '#475569';
  ctx.font = '700 22px JetBrains Mono, monospace';
  ctx.fillText('METERS', 128, 166);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createSponsorBoardTexture(
  variant: number,
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const configs = [
    { bg: '#151b24', bar: accentHex, title: 'SOLSTICE CIRCUIT', sub: 'GRAND TOURING SERIES' },
    { bg: '#e4dfd5', bar: '#b91c1c', title: 'APEX RADIAL', sub: 'ENDURANCE COMPOUND' },
    { bg: '#132238', bar: '#d97706', title: 'CHRONO LABS', sub: 'OFFICIAL TIMING' },
    { bg: '#1b241d', bar: '#10b981', title: 'VERDANT SYNTH', sub: 'HIGH OCTANE GT' },
  ];
  const cfg = configs[variant % configs.length];

  ctx.fillStyle = cfg.bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = cfg.bar;
  ctx.fillRect(0, 0, 26, 128);
  ctx.fillRect(486, 0, 26, 128);
  ctx.fillRect(26, 0, 460, 8);
  ctx.fillRect(26, 120, 460, 8);

  const darkBg = cfg.bg !== '#e4dfd5';
  ctx.fillStyle = darkBg ? '#e8e4dc' : '#141820';
  ctx.font = '800 42px Oxanium, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cfg.title, 256, 52);

  ctx.fillStyle = darkBg ? '#94a3b8' : '#475569';
  ctx.font = '700 18px JetBrains Mono, monospace';
  ctx.fillText(cfg.sub, 256, 94);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createPitBayHeaderTexture(
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#151b25';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 114, 1024, 14);

  const bays = ['GARAGE 01 · SOLSTICE', 'GARAGE 02 · APEX', 'GARAGE 03 · DRIFT', 'GARAGE 04 · RACE CTRL'];
  ctx.font = '800 28px Oxanium, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  bays.forEach((label, i) => {
    const cx = 128 + i * 256;
    if (i > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(i * 256 - 2, 16, 4, 86);
    }
    ctx.fillStyle = '#e5e2da';
    ctx.fillText(label, cx, 62, 236);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  const grad = ctx.createRadialGradient(64, 128, 12, 64, 128, 62);
  grad.addColorStop(0, 'rgba(6, 8, 12, 0.92)');
  grad.addColorStop(0.55, 'rgba(6, 8, 12, 0.5)');
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
  // Subtle, natural soft road illumination pool (never harsh or blinding)
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);

  const grad = ctx.createRadialGradient(64, 240, 8, 64, 150, 150);
  grad.addColorStop(0, 'rgba(255, 240, 208, 0.42)');
  grad.addColorStop(0.42, 'rgba(255, 236, 198, 0.16)');
  grad.addColorStop(0.82, 'rgba(255, 232, 190, 0.04)');
  grad.addColorStop(1, 'rgba(255, 232, 190, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 256);

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
      ctx.fillStyle = (r + c) % 2 === 0 ? '#dbd7ce' : '#1b2028';
      ctx.fillRect(c * sq, r * sq, sq, sq);
      ctx.fillRect(1024 - (c + 1) * sq, r * sq, sq, sq);
    }
  }

  ctx.fillStyle = accentHex;
  ctx.fillRect(64, 0, 896, 8);
  ctx.fillRect(64, 120, 896, 8);

  ctx.fillStyle = '#ebe8e0';
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

  ctx.fillStyle = '#151922';
  ctx.fillRect(0, 0, 256, 128);

  // Subtle metallic frame border + corner rivets
  ctx.strokeStyle = 'rgba(220,224,232,0.28)';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 120);

  ctx.fillStyle = accentHex;
  for (const ox of [54, 146]) {
    ctx.beginPath();
    ctx.moveTo(ox, 22);
    ctx.lineTo(ox + 40, 22);
    ctx.lineTo(ox + 74, 64);
    ctx.lineTo(ox + 40, 106);
    ctx.lineTo(ox, 106);
    ctx.lineTo(ox + 34, 64);
    ctx.closePath();
    ctx.fill();
  }

  // Subtle bolt heads in corners
  ctx.fillStyle = '#8b95a5';
  for (const [bx, by] of [
    [16, 16],
    [240, 16],
    [16, 112],
    [240, 112],
  ]) {
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
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

  ctx.fillStyle = '#0d1119';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 512, 10);
  ctx.fillRect(0, 246, 512, 10);

  ctx.fillStyle = '#e8e4dc';
  ctx.font = '800 30px Oxanium, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SOLSTICE GT', 26, 54);

  ctx.fillStyle = accentHex;
  ctx.font = '700 20px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('RACE TIMING', 486, 52);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(26, 74, 460, 2);

  const rows = [
    ['01', 'YOU', 'GT-07'],
    ['02', 'VERA', 'APX-11'],
    ['03', 'KAI', 'DRF-42'],
    ['04', 'SORA', 'SLP-88'],
  ];
  ctx.font = '700 23px JetBrains Mono, monospace';
  rows.forEach(([pos, driver, tag], idx) => {
    const y = 112 + idx * 34;
    ctx.fillStyle = idx === 0 ? accentHex : '#8b96a8';
    ctx.textAlign = 'left';
    ctx.fillText(pos, 30, y);
    ctx.fillStyle = '#e2dfd7';
    ctx.fillText(driver, 94, y);
    ctx.fillStyle = '#9aa6b8';
    ctx.textAlign = 'right';
    ctx.fillText(tag, 482, y);
  });

  ctx.fillStyle = '#6f7b8e';
  ctx.font = '600 15px Plus Jakarta Sans, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(courseName.toUpperCase(), 26, 232);

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

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 50, 256, 26);
  ctx.fillStyle = 'rgba(18,22,30,0.88)';
  ctx.fillRect(0, 76, 256, 8);

  ctx.fillStyle = '#ebe7de';
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
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
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

  ctx.fillStyle = '#ebe7de';
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

export function createCarbonWeaveTexture(maxAnisotropy: number): {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  // Authentic 2x2 diagonal twill motorsport carbon fiber weave
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;

  ctx.fillStyle = '#12161d';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#505050';
  bctx.fillRect(0, 0, size, size);

  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    const row = Math.floor(y / cell);
    for (let x = 0; x < size; x += cell) {
      const col = Math.floor(x / cell);
      const phase = (col + row) % 4;
      const isWarp = phase < 2;

      if (isWarp) {
        const g = ctx.createLinearGradient(x, y, x + cell, y);
        g.addColorStop(0, '#141922');
        g.addColorStop(0.5, '#313a49');
        g.addColorStop(1, '#141922');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, cell, cell - 1);

        bctx.fillStyle = '#c8c8c8';
        bctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      } else {
        const g = ctx.createLinearGradient(x, y, x, y + cell);
        g.addColorStop(0, '#0f131a');
        g.addColorStop(0.5, '#242b37');
        g.addColorStop(1, '#0f131a');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, cell - 1, cell);

        bctx.fillStyle = '#909090';
        bctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(5, 5);
  albedo.anisotropy = maxAnisotropy;

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(5, 5);
  bump.anisotropy = maxAnisotropy;

  return { albedo, bump };
}

export function createBrakeRotorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  // Cross-drilled and slotted carbon-ceramic/steel GT brake disc
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#8b94a3';
  ctx.fillRect(0, 0, size, size);

  // Concentric brushed machining grooves
  for (let r = 42; r < 124; r += 2) {
    const v = 128 + Math.round(Math.sin(r * 0.9) * 22);
    ctx.strokeStyle = `rgb(${v},${v + 3},${v + 7})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Dark anodized inner rotor hat & hub bolts
  ctx.fillStyle = '#242a34';
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#475162';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Cross-drilled ventilation hole arcs (12 swept radial rows)
  ctx.fillStyle = '#181d25';
  for (let s = 0; s < 12; s++) {
    const baseAngle = (s / 12) * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const rr = 58 + k * 16;
      const ang = baseAngle + k * 0.085;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createTireTreadTexture(maxAnisotropy: number): THREE.CanvasTexture {
  // Semi-slick GT racing tire tread with twin circumferential grooves & angled shoulder sipes
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(5151);

  ctx.fillStyle = '#191c22';
  ctx.fillRect(0, 0, 256, 256);

  // Fine vulcanized rubber micro-grain
  for (let i = 0; i < 4200; i++) {
    const v = Math.floor(18 + rand() * 24);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    ctx.fillRect(rand() * 256, rand() * 256, 2, 2);
  }

  // Twin longitudinal water-evacuation grooves
  ctx.fillStyle = '#090b0e';
  ctx.fillRect(0, 88, 256, 12);
  ctx.fillRect(0, 156, 256, 12);

  // Subtle angled motorsport shoulder sipes
  ctx.strokeStyle = '#0a0c10';
  ctx.lineWidth = 4;
  for (let x = -32; x < 288; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 22);
    ctx.lineTo(x + 18, 76);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 18, 180);
    ctx.lineTo(x, 234);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createCockpitDashTexture(
  accentHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0a0e16';
  ctx.fillRect(0, 0, 256, 64);

  // Subtle GT telemetry RPM bar
  const segs = 14;
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i < 8 ? '#22c55e' : i < 12 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(14 + i * 16, 10, 11, 10);
  }

  ctx.fillStyle = accentHex;
  ctx.font = '800 24px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GT-R  04', 128, 44);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createConcreteFormworkTexture(maxAnisotropy: number): {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  // Architectural board-formed cast concrete with subtle panel joints & formwork tie-rod dimples
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(8123);

  ctx.fillStyle = '#c4bfb5';
  ctx.fillRect(0, 0, size, size);

  // Soft mineral mottling & cement patina
  for (let i = 0; i < 160; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 48;
    const v = rand() > 0.5 ? 222 : 162;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v - 2},${v - 6},0.10)`);
    g.addColorStop(1, `rgba(${v},${v - 2},${v - 6},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine mineral grain
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(158 + rand() * 64);
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 5},0.14)`;
    ctx.fillRect(rand() * size, rand() * size, 2, 2);
  }

  // Crisp architectural panel grid seams
  ctx.strokeStyle = 'rgba(65,68,74,0.34)';
  ctx.lineWidth = 2.5;
  for (let y = 0; y < size; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (let x = 0; x < size; x += 256) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  // Recessed circular tie-rod cones in each formwork panel
  for (let py = 0; py < size; py += 128) {
    for (let px = 0; px < size; px += 256) {
      for (const [ox, oy] of [
        [44, 38],
        [212, 38],
        [44, 90],
        [212, 90],
      ]) {
        ctx.fillStyle = 'rgba(54,58,64,0.45)';
        ctx.beginPath();
        ctx.arc(px + ox, py + oy, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(3, 2);
  albedo.anisotropy = maxAnisotropy;

  const bump = new THREE.CanvasTexture(canvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(3, 2);
  bump.anisotropy = maxAnisotropy;

  return { albedo, bump };
}

export function createTimberSoffitTexture(maxAnisotropy: number): THREE.CanvasTexture {
  // Architectural slatted cedar/walnut ceiling soffit with dark acoustic shadow reveals
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rand = seededRand(4412);

  ctx.fillStyle = '#20150e';
  ctx.fillRect(0, 0, 256, 256);

  const slatW = 16;
  for (let x = 0; x < 256; x += slatW) {
    const r = Math.floor(116 + rand() * 34);
    const g = Math.floor(74 + rand() * 24);
    const b = Math.floor(44 + rand() * 18);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x + 2, 0, slatW - 4, 256);

    // Longitudinal wood grain streaks
    for (let k = 0; k < 18; k++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,220,180,0.06)' : 'rgba(24,14,8,0.12)';
      ctx.fillRect(x + 2 + rand() * (slatW - 5), 0, 1.5, 256);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 3);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createPennantFlagTexture(
  accentHex: string,
  variant: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  if (variant % 3 === 0) {
    // Classic motorsport checkered flag
    const sq = 32;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#ebe7de' : '#181c24';
        ctx.fillRect(c * sq, r * sq, sq, sq);
      }
    }
  } else if (variant % 3 === 1) {
    // Solstice circuit pennant with diagonal stripe
    ctx.fillStyle = '#151c28';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = accentHex;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(148, 0);
    ctx.lineTo(96, 128);
    ctx.lineTo(0, 128);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ebe7de';
    ctx.fillRect(0, 108, 256, 10);
  } else {
    // Warm cream & accent racing banner
    ctx.fillStyle = '#e8e3d8';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 44, 256, 40);
    ctx.fillStyle = '#161b24';
    ctx.fillRect(0, 36, 256, 8);
    ctx.fillRect(0, 84, 256, 8);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createDelineatorPostTexture(maxAnisotropy: number): THREE.CanvasTexture {
  // Motorsport flexible roadside delineator bollard: vulcanized black rubber base + bright white/safety-orange bands
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // High-density white polymer cylinder shaft
  ctx.fillStyle = '#e7e8ec';
  ctx.fillRect(0, 0, 64, 256);

  // Subtle vertical shading seam for cylindrical depth
  const grad = ctx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.08)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  // Safety-orange retroreflective motorsport collar bands (top & upper-mid)
  ctx.fillStyle = '#e85d1a';
  ctx.fillRect(0, 26, 64, 42);
  ctx.fillRect(0, 94, 64, 34);

  // Crisp silver retroreflective micro-stripe inside upper collar
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 42, 64, 10);

  // Matte black flexible rubber base boot
  ctx.fillStyle = '#1b1f27';
  ctx.fillRect(0, 210, 64, 46);

  // Dark rubber top cap rim
  ctx.fillStyle = '#252a34';
  ctx.fillRect(0, 0, 64, 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}


