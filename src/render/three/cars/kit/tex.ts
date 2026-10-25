// Procedural canvas textures for the kit: tyre sidewall lettering (bump + white-letter colour), tread patterns,
// brake-disc faces (machining, slots, heat), the spinning-wheel blur disc, and small decal/badge canvases.
import * as THREE from 'three';

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

export function texFrom(c: HTMLCanvasElement, opts: { srgb?: boolean; wrapS?: boolean; wrapT?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = opts.wrapS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = opts.wrapT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}

// Deterministic noise so textures are identical every build.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Relative luminance of a '#rrggbb' colour (0..1). */
export function lum(c: string): number {
  const k = new THREE.Color(c);
  return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
}

export type TyreKind = 'eco' | 'street' | 'sport' | 'rcomp' | 'slick' | 'skinny';

const SIDEWALL_TEXT: Record<TyreKind, { big: string; small: string }> = {
  eco: { big: 'ECONORIDE  A/S', small: '205/60R15  91H  M+S' },
  street: { big: 'REVLOTTO  STREET-R', small: '225/45ZR17  94W  XL' },
  sport: { big: 'REVLOTTO  SPORT-RS', small: '275/35ZR19  100Y  EXTREME PERFORMANCE' },
  rcomp: { big: 'REVLOTTO  R-COMP 200', small: '335/30ZR20  DOT  COMPETITION USE ONLY' },
  slick: { big: 'DRAGZILLA  ET PRO', small: 'DRAG RACING ONLY  33x14.5-15' },
  skinny: { big: 'DRAGZILLA FRONT', small: '26x4.5-15  FRONT RUNNER' },
};

/**
 * Sidewall textures: u = around the tyre (2 text repeats), v = bead (0) to shoulder (1).
 * `aspect` = metres per u-pixel / metres per v-pixel, so the lettering keeps its proportions.
 * Returns a height map (bump) and, for slicks, a colour map with white letters.
 */
function sidewallCanvases(kind: TyreKind, aspect: number): { bump: HTMLCanvasElement; map?: HTMLCanvasElement } {
  const W = 2048;
  const H = 256;
  const [hc, h] = canvas(W, H);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, W, H);
  // rim protector ridge + fine concentric ribs (canvas y 0 = shoulder, H = bead)
  const band = (v0: number, v1: number, c: string) => {
    h.fillStyle = c;
    h.fillRect(0, H * (1 - v1), W, H * (v1 - v0));
  };
  band(0.04, 0.12, '#a8a8a8');
  band(0.12, 0.14, '#6a6a6a');
  band(0.9, 0.915, '#9a9a9a');
  band(0.94, 0.955, '#9a9a9a');
  const t = SIDEWALL_TEXT[kind];
  const white = kind === 'slick' || kind === 'skinny';
  const [cc, c] = white ? canvas(W, H) : [null, null];
  if (c) {
    c.fillStyle = '#16161a';
    c.fillRect(0, 0, W, H);
  }
  const sx = 1 / Math.max(0.2, aspect); // squash horizontally so letters keep their shape on the tyre
  const draw = (ctx: CanvasRenderingContext2D, fill: string, blur: number) => {
    ctx.save();
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = fill;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const u of [0.25, 0.75]) {
      ctx.save();
      ctx.translate(W * u, H * (1 - 0.55));
      ctx.scale(sx, 1);
      ctx.font = `italic 900 ${Math.round(H * (white ? 0.4 : 0.34))}px "Arial Black", Impact, sans-serif`;
      ctx.fillText(t.big, 0, 0, (W * 0.4) / sx);
      ctx.restore();
    }
    for (const u of [0.0, 0.5, 1.0]) {
      ctx.save();
      ctx.translate(W * u, H * (1 - 0.3));
      ctx.scale(sx, 1);
      ctx.font = `700 ${Math.round(H * 0.12)}px Arial, sans-serif`;
      ctx.fillText(t.small, 0, 0, (W * 0.3) / sx);
      ctx.restore();
    }
    ctx.restore();
  };
  draw(h, '#d8d8d8', 1.2);
  draw(h, '#c4c4c4', 0);
  if (c) {
    draw(c, '#e9e5da', 0);
    // a little wear on the paint
    const r = rng(7);
    c.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(30,30,34,${0.15 + r() * 0.35})`;
      c.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 2);
    }
    c.globalCompositeOperation = 'source-over';
  }
  return { bump: hc, map: cc ?? undefined };
}

/** Tread bump pattern: u = around (circumference metres `circ`), v = across the tread (width metres `wid`). */
function treadCanvas(kind: TyreKind, circ: number, wid: number, grooves: number[][]): HTMLCanvasElement {
  const W = 1024;
  const H = 256;
  const [cv, g] = canvas(W, H);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, W, H);
  const px = W / circ; // px per metre along u
  const py = H / wid; // px per metre across
  const dark = '#262626';
  g.strokeStyle = dark;
  g.lineCap = 'round';
  const rep = (period: number, f: (x: number, k: number) => void) => {
    const n = Math.max(1, Math.round(circ / period));
    for (let k = 0; k < n; k++) f((k / n) * W, k);
  };
  if (kind === 'eco') {
    rep(0.028, (x, k) => {
      g.lineWidth = 0.0045 * px;
      for (const [v0, v1, off] of [[0.06, 0.3, 0], [0.36, 0.64, 0.5], [0.7, 0.94, 0]] as const) {
        const xx = x + off * 0.028 * px;
        g.beginPath();
        g.moveTo(xx, H * (1 - v0));
        g.lineTo(xx + 0.004 * px, H * (1 - v1));
        g.stroke();
      }
      g.lineWidth = 1.2;
      g.beginPath();
      const xs = x + 0.014 * px;
      for (let i = 0; i <= 6; i++) g.lineTo(xs + (i % 2 ? 2 : -2), H * (1 - 0.08 - (0.84 * i) / 6));
      g.stroke();
      void k;
    });
  } else if (kind === 'street') {
    // directional V grooves from the centre line outwards
    rep(0.034, (x) => {
      g.lineWidth = 0.006 * py;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, H * 0.5 + s * 0.02 * py);
        g.quadraticCurveTo(x + 0.025 * px, H * 0.5 + s * 0.045 * py, x + 0.05 * px, H * 0.5 + s * 0.5 * H);
        g.stroke();
      }
    });
  } else if (kind === 'sport') {
    rep(0.045, (x) => {
      g.lineWidth = 0.007 * py;
      g.beginPath();
      g.moveTo(x, H * 0.02);
      g.lineTo(x + 0.01 * px, H * 0.24);
      g.stroke();
      g.lineWidth = 0.003 * py;
      g.beginPath();
      g.moveTo(x + 0.02 * px, H * 0.62);
      g.lineTo(x + 0.03 * px, H * 0.98);
      g.stroke();
    });
  } else if (kind === 'rcomp') {
    rep(0.06, (x) => {
      g.lineWidth = 0.004 * py;
      g.beginPath();
      g.moveTo(x, H * 0.0);
      g.lineTo(x + 0.012 * px, H * 0.1);
      g.moveTo(x + 0.03 * px, H * 1.0);
      g.lineTo(x + 0.042 * px, H * 0.9);
      g.stroke();
    });
  } else {
    // slicks / skinnies: faint scrub texture only
    const r = rng(3);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '120,120,120' : '150,150,150'},0.5)`;
      g.fillRect(r() * W, 4 + r() * (H - 4), 2 + r() * 6, 1);
    }
  }
  // circumferential grooves (formerly geometry): [centre -1..1 across the tread, width m]
  g.fillStyle = '#1e1e1e';
  for (const [c, w] of grooves) {
    const y = H * (1 - (c + 1) / 2);
    const h = Math.max(2, w * py);
    g.fillRect(0, y - h / 2, W, h);
    g.fillStyle = '#4a4a4a';
    g.fillRect(0, y - h / 2 - 1, W, 1);
    g.fillRect(0, y + h / 2, W, 1);
    g.fillStyle = '#1e1e1e';
  }
  return cv;
}

/**
 * One texture pair for the whole tyre (single material): v 0..0.5 = sidewall (bead → shoulder, lettering mirrored so
 * it reads from outside), v 0.5..1 = tread (around × across). Returns a height map (bump) and a colour map.
 */
/** Average every row of a canvas (an infinitely long horizontal motion blur), by repeated 2x downscales. */
function rowMean(src: HTMLCanvasElement): HTMLCanvasElement {
  let cur = src;
  let w = src.width;
  while (w > 1) {
    w = Math.max(1, w >> 1);
    const [c, g] = canvas(w, src.height);
    g.imageSmoothingEnabled = true;
    g.drawImage(cur, 0, 0, w, src.height);
    cur = c;
  }
  const [out, o] = canvas(src.width, src.height);
  o.imageSmoothingEnabled = false;
  o.drawImage(cur, 0, 0, src.width, src.height);
  return out;
}

export function tyreAtlas(kind: TyreKind, aspect: number, circ: number, wid: number, grooves: number[][], smeared = false): { bump: THREE.CanvasTexture; map: THREE.CanvasTexture } {
  const W = 2048;
  const H = 512;
  const side0 = sidewallCanvases(kind, aspect);
  // smeared variant (swapped in at full motion blur): lettering averaged around the tyre into rings
  const side = smeared ? { bump: rowMean(side0.bump), map: side0.map ? rowMean(side0.map) : undefined } : side0;
  const tread = treadCanvas(kind, circ, wid, grooves);
  const [bc, b] = canvas(W, H);
  b.drawImage(tread, 0, 0, W, H / 2);
  b.save();
  b.translate(W, H / 2);
  b.scale(-1, 1);
  b.drawImage(side.bump, 0, 0, W, H / 2);
  b.restore();
  const [mc, m] = canvas(W, H);
  m.fillStyle = '#19191c';
  m.fillRect(0, 0, W, H);
  if (side.map) {
    m.save();
    m.translate(W, H / 2);
    m.scale(-1, 1);
    m.drawImage(side.map, 0, 0, W, H / 2);
    m.restore();
  }
  return { bump: texFrom(bc, { wrapS: true }), map: texFrom(mc, { srgb: true, wrapS: true }) };
}

/** Brake disc face (planar UVs, centre 0.5/0.5, edge at radius 0.5): colour + emissive glow mask. */
export function discTextures(kind: 'plain' | 'slotted' | 'drilled', rIn: number, holes: [number, number, number][]): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const S = 512;
  const [cv, g] = canvas(S, S);
  const c = S / 2;
  g.fillStyle = '#6c6c70';
  g.fillRect(0, 0, S, S);
  const r = rng(11);
  // machining rings
  for (let rad = rIn * c; rad < c; rad += 1) {
    const l = 120 + Math.floor(r() * 50);
    g.strokeStyle = `rgb(${l},${l},${l + 3})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(c, c, rad, 0, Math.PI * 2);
    g.stroke();
  }
  // heat tint band near the outer edge, darker pad track edges
  const grd = g.createRadialGradient(c, c, rIn * c, c, c, c);
  grd.addColorStop(0, 'rgba(40,40,46,0.5)');
  grd.addColorStop(0.08, 'rgba(0,0,0,0)');
  grd.addColorStop(0.85, 'rgba(90,70,110,0.18)');
  grd.addColorStop(0.97, 'rgba(70,50,40,0.35)');
  grd.addColorStop(1, 'rgba(20,20,22,0.8)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  if (kind !== 'plain') {
    // curved slots
    g.strokeStyle = 'rgba(18,18,20,0.95)';
    g.lineCap = 'round';
    g.lineWidth = S * 0.012;
    const n = kind === 'slotted' ? 8 : 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.2;
      g.beginPath();
      const r0 = (rIn + 0.08) * c;
      const r1 = 0.94 * c;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const rr = r0 + (r1 - r0) * t;
        const aa = a + t * 0.45;
        if (i === 0) g.moveTo(c + Math.cos(aa) * rr, c - Math.sin(aa) * rr);
        else g.lineTo(c + Math.cos(aa) * rr, c - Math.sin(aa) * rr);
      }
      g.stroke();
    }
  }
  // chamfer rings around drilled holes (geometry holes; holes are [x, y, r] in disc-radius units)
  g.strokeStyle = 'rgba(25,25,28,0.9)';
  g.lineWidth = 3;
  for (const [x, y, hr] of holes) {
    g.beginPath();
    g.arc(c + x * c, c - y * c, hr * c + 2, 0, Math.PI * 2);
    g.stroke();
  }
  const [gc, gg] = canvas(128, 128);
  const gr = gg.createRadialGradient(64, 64, rIn * 64, 64, 64, 64);
  gr.addColorStop(0, '#000');
  gr.addColorStop(0.15, '#888');
  gr.addColorStop(0.6, '#fff');
  gr.addColorStop(1, '#ffd9b0');
  gg.fillStyle = gr;
  gg.fillRect(0, 0, 128, 128);
  return { map: texFrom(cv, { srgb: true }), glow: texFrom(gc, { srgb: true }) };
}

/**
 * The motion-blur disc (radius = disc edge): an opaque smear of the rim inside rimFrac (the spokes are hidden behind
 * it at full blur, so nothing strobes), a polished lip ring, and the sidewall lettering band smeared into the mean
 * sidewall grey at ~0.85 alpha. Everything else is transparent (the tyre's silhouette stays real).
 */
export function blurTexture(rim: string, rimFrac: number, band: [number, number], bandColor: string, spokeCover: number): THREE.CanvasTexture {
  const S = 256;
  const [cv, g] = canvas(S, S);
  const c = S / 2;
  const col = new THREE.Color(rim);
  const dark = new THREE.Color(0x0c0c10);
  const mix = dark.clone().lerp(col, spokeCover);
  // canvas pixels are sRGB: convert from three's linear working space (else every colour comes out far too dark)
  const srgb = { r: 0, g: 0, b: 0 };
  const css = (k: THREE.Color, a: number) => {
    k.getRGB(srgb, THREE.SRGBColorSpace);
    return `rgba(${Math.round(srgb.r * 255)},${Math.round(srgb.g * 255)},${Math.round(srgb.b * 255)},${a})`;
  };
  const R = c * rimFrac;
  const gr = g.createRadialGradient(c, c, 0, c, c, R);
  gr.addColorStop(0, css(col.clone().lerp(new THREE.Color(1, 1, 1), 0.15), 1));
  gr.addColorStop(0.16, css(col, 1));
  gr.addColorStop(0.26, css(mix, 1));
  gr.addColorStop(0.86, css(mix, 1));
  gr.addColorStop(0.93, css(new THREE.Color(0xd8d8de), 1));
  gr.addColorStop(1, css(new THREE.Color(0x9a9aa2), 1));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  // faint streak rings
  const r = rng(5);
  for (let i = 0; i < 24; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(c, c, R * (0.3 + r() * 0.6), 0, Math.PI * 2);
    g.stroke();
  }
  // lettering band in the mean sidewall grey
  const bc = new THREE.Color(bandColor);
  const r0 = c * band[0];
  const r1 = c * band[1];
  const bg = g.createRadialGradient(c, c, r0, c, c, r1);
  bg.addColorStop(0, css(bc, 0));
  bg.addColorStop(0.08, css(bc, 0.97));
  bg.addColorStop(0.92, css(bc, 0.97));
  bg.addColorStop(1, css(bc, 0));
  g.strokeStyle = bg;
  g.lineWidth = r1 - r0;
  g.beginPath();
  g.arc(c, c, (r0 + r1) / 2, 0, Math.PI * 2);
  g.stroke();
  return texFrom(cv, { srgb: true });
}

/** Text on a transparent canvas (badges, caliper logos, decals). */
export function textCanvas(text: string, opts: { w?: number; h?: number; color?: string; font?: string; bg?: string; stroke?: string } = {}): HTMLCanvasElement {
  const W = opts.w ?? 256;
  const H = opts.h ?? 64;
  const [cv, g] = canvas(W, H);
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.fillRect(0, 0, W, H);
  }
  g.font = opts.font ?? `italic 900 ${Math.round(H * 0.7)}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.strokeStyle = opts.stroke;
    g.lineWidth = H * 0.08;
    g.strokeText(text, W / 2, H / 2 + H * 0.04, W * 0.94);
  }
  g.fillStyle = opts.color ?? '#ffffff';
  g.fillText(text, W / 2, H / 2 + H * 0.04, W * 0.94);
  return cv;
}
