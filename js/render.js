// Draws a map document onto a 2D canvas. Used for both the editor view and PNG export.
//
// Features are drawn in document order (the Layers tab). Districts are composed
// in offscreen layers so that anything above them (roads, plazas, rivers, lakes,
// walls, buildings) CUTS into the blocks rather than being painted on top: the
// block outlines then wrap neatly around every street, plaza and riverbank.

import * as G from './geom.js';
import { districtGen, farmGen, fieldsGen } from './generate.js';
import { THEMES, FONT_WEIGHTS } from './themes.js';
import { makeNoise, hashStr, mulberry32 } from './rng.js';

export function getColors(doc) {
  const t = THEMES[doc.settings.theme] || THEMES.patina;
  const c = { ...t.colors };
  for (const [k, v] of Object.entries(doc.settings.colors || {})) if (v) c[k] = v;
  return c;
}

const CLOSED = { wall: 1, district: 1, farm: 1, water: 1, building: 1 };
const POINT_TYPES = { plaza: 1, landmark: 1, label: 1, compass: 1 };
const CARVERS = { road: 1, plaza: 1, river: 1, water: 1, wall: 1, building: 1 };
export const isClosed = (f) => !!CLOSED[f.type] || (f.type === 'road' && !!f.closed);
export const isPointType = (f) => !!POINT_TYPES[f.type];

export function findWalls(doc) {
  return doc.features.filter((f) => f.type === 'wall' && !f.hidden && f.points.length >= 3);
}

export function linkedWall(doc, f) {
  if (!f.followWall) return null;
  const walls = findWalls(doc);
  return walls.find((w) => w.id === f.followWall) || null;
}

// The drawn outline of a feature (spline-smoothed or densified), in world units.
export function featureShape(f, doc) {
  if (f.type === 'district' && f.followWall) {
    const w = linkedWall(doc, f);
    return w ? featureShape(w, doc) : [];
  }
  const pts = f.points || [];
  if (!pts.length) return [];
  if (POINT_TYPES[f.type]) return pts;
  const closed = isClosed(f);
  if (f.smooth && pts.length >= 3) return G.smoothPoints(pts, closed, 6);
  return G.densify(pts, closed, 10);
}

function addPath(ctx, pts, closed) {
  if (!pts.length) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

function circle(ctx, c, r) {
  ctx.moveTo(c[0] + r, c[1]);
  ctx.arc(c[0], c[1], Math.max(0, r), 0, Math.PI * 2);
}

// ---------- offscreen layers ----------
const layers = [];
function getLayer(i, ctx) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let c = layers[i];
  if (!c) { c = document.createElement('canvas'); layers[i] = c; }
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);
  g.setTransform(ctx.getTransform());
  g.lineCap = 'round'; g.lineJoin = 'round';
  return g;
}
function blit(ctx, g) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(g.canvas, 0, 0);
  ctx.restore();
}
export function releaseLayers() { for (const c of layers) if (c) { c.width = 0; c.height = 0; } }

// ---------- patterns ----------
const patternCache = new Map();
function hatchPattern(ctx, color, spacing) {
  const key = 'h' + color + spacing;
  if (patternCache.has(key)) return patternCache.get(key);
  const RES = 4, T = Math.max(2, spacing) * 4;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(T * RES);
  const g = c.getContext('2d');
  g.strokeStyle = color; g.globalAlpha = 0.5; g.lineWidth = 0.9 * RES;
  const step = (T / 4) * RES, S = T * RES;
  for (let x = -S; x <= 2 * S; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + S, S); g.stroke(); }
  const p = ctx.createPattern(c, 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().scale(1 / RES));
  patternCache.set(key, p);
  return p;
}

function ripplePattern(ctx, color) {
  const key = 'r' + color;
  if (patternCache.has(key)) return patternCache.get(key);
  const RES = 3, T = 60;
  const c = document.createElement('canvas');
  c.width = c.height = T * RES;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.lineWidth = 0.8 * RES;
  const rnd = makeNoise(7);
  for (let y = 4; y < T; y += 8) {
    for (let x = 0; x < T; x += 20) {
      const ox = (rnd(x * 0.1, y * 0.1) + 1) * 6;
      g.beginPath(); g.moveTo((x + ox) * RES, y * RES); g.lineTo((x + ox + 9) * RES, y * RES); g.stroke();
    }
  }
  const p = ctx.createPattern(c, 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().scale(1 / RES));
  patternCache.set(key, p);
  return p;
}

// ---------- text ----------
function fontStr(fam, size, italic) {
  const w = FONT_WEIGHTS[fam] || 400;
  return `${italic ? 'italic ' : ''}${w} ${size}px "${fam}", Georgia, serif`;
}

// Letter-spaced, multi-line, optionally haloed or boxed text. Returns its hit polygon.
export function drawText(ctx, text, x, y, o) {
  if (!text) return null;
  const size = Math.max(1, o.size);
  const lines = (o.upper ? text.toUpperCase() : text).split('\n');
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((o.angle || 0) * Math.PI) / 180);
  ctx.font = fontStr(o.family, size, o.italic);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const sp = (o.spacing || 0) * size, lh = size * 1.18;
  const cw = new Map();
  const wOf = (ch) => { if (!cw.has(ch)) cw.set(ch, ctx.measureText(ch).width); return cw.get(ch); };
  const lw = lines.map((l) => { const cs = [...l]; return cs.reduce((s, ch) => s + wOf(ch), 0) + sp * Math.max(0, cs.length - 1); });
  const maxW = Math.max(1, ...lw), th = lh * lines.length;
  let bx = -maxW / 2, by = -th / 2, bw = maxW, bh = th;
  if (o.boxed) {
    const pad = size * 0.55;
    bx -= pad; by -= pad * 0.75; bw += pad * 2; bh += pad * 1.5;
    ctx.fillStyle = o.boxFill; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = o.boxStroke; ctx.lineWidth = size * 0.13; ctx.strokeRect(bx, by, bw, bh);
    const i = size * 0.24;
    ctx.lineWidth = size * 0.04; ctx.strokeRect(bx + i, by + i, bw - 2 * i, bh - 2 * i);
  }
  const passes = o.halo ? ['h', 'f'] : ['f'];
  for (const pass of passes) {
    if (pass === 'h') { ctx.strokeStyle = o.halo; ctx.lineWidth = o.haloW || size * 0.3; ctx.lineJoin = 'round'; }
    else ctx.fillStyle = o.fill;
    lines.forEach((l, i) => {
      let cx = -lw[i] / 2;
      const cy = -th / 2 + lh * (i + 0.5);
      for (const ch of l) {
        if (ch !== ' ') { if (pass === 'h') ctx.strokeText(ch, cx, cy); else ctx.fillText(ch, cx, cy); }
        cx += wOf(ch) + sp;
      }
    });
  }
  ctx.restore();
  const a = ((o.angle || 0) * Math.PI) / 180;
  return [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]].map((p) => G.add(G.rotate(p, a), [x, y]));
}

function drawTextOnPath(ctx, pts, text, o) {
  if (!text || pts.length < 2) return null;
  let path = pts, cum = G.cumLengths(path), pos = o.pos;
  const L = cum[cum.length - 1];
  if (G.pointAt(path, cum, L * pos).dir[0] < 0) { path = pts.slice().reverse(); cum = G.cumLengths(path); pos = 1 - pos; }
  const size = o.size, chars = [...text.toUpperCase()];
  ctx.save();
  ctx.font = fontStr(o.family, size, false);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const sp = o.spacing * size;
  const ws = chars.map((c) => ctx.measureText(c).width);
  const total = ws.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  const s0 = Math.max(0, Math.min(L - total, L * pos - total / 2));
  const placed = [];
  let s = s0;
  chars.forEach((ch, i) => { placed.push({ ch, at: G.pointAt(path, cum, s + ws[i] / 2) }); s += ws[i] + sp; });
  for (const pass of o.halo ? ['h', 'f'] : ['f']) {
    if (pass === 'h') { ctx.strokeStyle = o.halo; ctx.lineWidth = o.haloW; ctx.lineJoin = 'round'; } else ctx.fillStyle = o.fill;
    for (const { ch, at } of placed) {
      if (ch === ' ') continue;
      ctx.save();
      ctx.translate(at.p[0], at.p[1]);
      ctx.rotate(Math.atan2(at.dir[1], at.dir[0]));
      if (pass === 'h') ctx.strokeText(ch, 0, 0); else ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
  const b = G.bbox(placed.map((q) => q.at.p));
  const h = size * 0.7;
  return [[b.x0 - h, b.y0 - h], [b.x1 + h, b.y0 - h], [b.x1 + h, b.y1 + h], [b.x0 - h, b.y1 + h]];
}

export const LABEL_STYLES = {
  district: { name: 'District (large, spaced)', font: 'fontLabel', fill: 'label', halo: 'labelHalo', upper: true },
  place: { name: 'Place (small caps)', font: 'fontLabel', fill: 'label', halo: 'labelHalo', upper: true },
  gate: { name: 'Outside / gate (accent)', font: 'fontLabel', fill: 'accent', halo: 'labelHalo', upper: true },
  water: { name: 'Water', font: 'fontLabel', fill: 'waterText', halo: 'waterHalo', upper: true },
  ink: { name: 'Plain ink', font: 'fontLabel', fill: 'outline', halo: null, upper: false },
  script: { name: 'Script (italic)', font: 'fontScript', fill: 'outline', halo: 'labelHalo', upper: false, italic: true },
  title: { name: 'Title box', font: 'fontTitle', fill: 'accent', halo: null, upper: true, boxed: true },
};

// ---------- geometry caches per render ----------
function toneColor(C, tone) {
  return tone === 'dark' ? C.blockDark : tone === 'light' ? C.blockLight : tone === 'park' ? C.park : C.block;
}

function riverGeom(f, sh) {
  const nrm = G.pathNormals(sh, false), cum = G.cumLengths(sh);
  const nz = makeNoise(hashStr(f.id));
  const rough = makeNoise(hashStr(f.id) ^ 0x1234567);
  const wob = f.canal ? 0 : +f.wobble || 0;
  const half = f.width / 2;
  const wl = [], wr = [];
  for (let i = 0; i < sh.length; i++) {
    const base = half * Math.max(0.3, 1 + wob * nz(cum[i] / (f.width * 2.5), 0.5) * 1.4);
    const jit = f.canal ? 0 : Math.min(3, half * 0.08);
    wl.push(base + rough(cum[i] / 11, 1.7) * jit);
    wr.push(base + rough(cum[i] / 11, 8.3) * jit);
  }
  const L = sh.map((p, i) => [p[0] + nrm[i][0] * wl[i], p[1] + nrm[i][1] * wl[i]]);
  const R = sh.map((p, i) => [p[0] - nrm[i][0] * wr[i], p[1] - nrm[i][1] * wr[i]]);
  return { L, R, wl, wr, nrm, cum, poly: L.concat(R.slice().reverse()) };
}

export function wallTowers(w, sh) {
  const out = [];
  const step = Math.max(10, +w.towerSpacing || 60);
  if (w.towerSize <= 0 || sh.length < 3) return out;
  if (w.cornerTowers !== false && !w.smooth) {
    const P = w.points, n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const d1 = G.norm(G.sub(b, a)), d2 = G.norm(G.sub(c, b));
      const turn = Math.acos(Math.max(-1, Math.min(1, G.dot(d1, d2))));
      if (turn < 0.45) continue;
      if (out.some((t) => G.dist(t.p, b) < step * 0.5)) continue;
      out.push({ p: b, r: w.towerSize * 1.4 });
    }
  }
  const ring = sh.concat([sh[0]]), cum = G.cumLengths(ring), L = cum[cum.length - 1];
  const count = Math.max(1, Math.round(L / step)), real = L / count;
  for (let i = 0; i < count; i++) {
    const p = G.pointAt(ring, cum, i * real).p;
    if (out.some((t) => G.dist(t.p, p) < real * 0.6)) continue;
    out.push({ p, r: w.towerSize });
  }
  return out;
}

// ---------- feature painters ----------
function drawWater(ctx, f, sh, C) {
  ctx.save();
  ctx.beginPath(); addPath(ctx, sh, true);
  ctx.fillStyle = C.water; ctx.fill();
  ctx.clip();
  ctx.globalAlpha = 0.45; ctx.fillStyle = ripplePattern(ctx, C.waterLine); ctx.fill(); ctx.globalAlpha = 1;
  const gap = 9;
  for (let i = f.coastLines; i >= 1; i--) {
    ctx.beginPath(); addPath(ctx, sh, true);
    ctx.strokeStyle = C.waterLine; ctx.lineWidth = 2 * i * gap + 1.2; ctx.stroke();
    ctx.strokeStyle = C.water; ctx.lineWidth = 2 * i * gap - 1.2; ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath(); addPath(ctx, sh, true);
  ctx.strokeStyle = C.waterEdge; ctx.lineWidth = 2; ctx.stroke();
}

function drawRiver(ctx, f, sh, geo, C) {
  if (sh.length < 2) return;
  const { L, R, wl, wr, nrm, cum, poly } = geo;
  ctx.save();
  ctx.beginPath(); addPath(ctx, poly, true);
  ctx.fillStyle = C.water; ctx.fill();
  ctx.clip();
  ctx.strokeStyle = C.waterLine; ctx.lineWidth = 1;
  if (f.canal) {
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); addPath(ctx, sh, false); ctx.stroke();
  } else {
    // Lines hug the banks and thin out toward the middle of the channel.
    const nz = makeNoise(hashStr(f.id) ^ 0x777);
    const m = Math.max(2, Math.round(f.width / 16));
    for (const side of [1, -1]) {
      const ws = side > 0 ? wl : wr;
      for (let k = 0; k < m; k++) {
        const t = k / m;
        const frac = 0.84 * (1 - Math.pow(t, 1.5));
        if (frac < 0.18) continue;
        const amp = k === 0 ? 1.8 : 1.1;
        ctx.beginPath();
        for (let i = 0; i < sh.length; i++) {
          const off = side * (frac * ws[i] - (k === 0 ? 1.5 : 0)) + nz(cum[i] / 14, k * 3.1 + side) * amp + Math.sin(cum[i] * 0.05 + k * 2.3) * 0.8;
          const x = sh[i][0] + nrm[i][0] * off, y = sh[i][1] + nrm[i][1] * off;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        if (k === 0) ctx.setLineDash([40 + ((side + 2) * 13) % 20, 3]);
        else ctx.setLineDash([10 + k * 5 + ((k * 7) % 9), 7 + k * 9]);
        ctx.lineDashOffset = k * 17 + side * 5;
        ctx.globalAlpha = Math.max(0.25, 0.95 - t * 0.9);
        ctx.lineWidth = k === 0 ? 1.2 : 0.9;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  ctx.restore();
  ctx.beginPath(); addPath(ctx, L, false); addPath(ctx, R, false);
  ctx.strokeStyle = C.waterEdge; ctx.lineWidth = f.canal ? 2.4 : 1.8; ctx.stroke();
}

function drawMonument(ctx, p, C, S) {
  const c = p.points[0], r = p.radius;
  ctx.beginPath();
  switch (p.monument) {
    case 'dot': circle(ctx, c, r * 0.28); ctx.fillStyle = C.outline; ctx.fill(); break;
    case 'ring':
      circle(ctx, c, r * 0.55); ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1.2, r * 0.08); ctx.stroke();
      ctx.beginPath(); circle(ctx, c, r * 0.18); ctx.fillStyle = C.outline; ctx.fill(); break;
    case 'fountain':
      circle(ctx, c, r * 0.5); ctx.fillStyle = C.water; ctx.fill(); ctx.strokeStyle = C.outline; ctx.lineWidth = S.outline * 1.3; ctx.stroke();
      ctx.beginPath(); circle(ctx, c, r * 0.14); ctx.fillStyle = C.outline; ctx.fill(); break;
    case 'obelisk': {
      const q = r * 0.3;
      ctx.moveTo(c[0], c[1] - q); ctx.lineTo(c[0] + q, c[1]); ctx.lineTo(c[0], c[1] + q); ctx.lineTo(c[0] - q, c[1]); ctx.closePath();
      ctx.fillStyle = C.outline; ctx.fill(); break;
    }
    case 'tree':
      circle(ctx, c, r * 0.45); ctx.fillStyle = C.park; ctx.fill(); ctx.strokeStyle = C.outline; ctx.lineWidth = S.outline; ctx.stroke(); break;
    default: break;
  }
}

function drawCompass(ctx, p, R, C, S) {
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.beginPath(); circle(ctx, [0, 0], R); ctx.fillStyle = C.frame; ctx.fill();
  ctx.beginPath(); circle(ctx, [0, 0], R * 0.8); ctx.fillStyle = C.paper; ctx.fill();
  ctx.strokeStyle = C.paper; ctx.lineWidth = R * 0.022;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84);
    ctx.lineTo(Math.cos(a) * R * 0.96, Math.sin(a) * R * 0.96); ctx.stroke();
  }
  ctx.strokeStyle = C.frame; ctx.lineWidth = R * 0.018;
  ctx.beginPath(); circle(ctx, [0, 0], R * 0.6); ctx.stroke();
  ctx.beginPath(); circle(ctx, [0, 0], R * 0.22); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6); ctx.stroke();
    ctx.beginPath(); circle(ctx, [Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7], R * 0.045);
    ctx.fillStyle = C.accent; ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.58); ctx.lineTo(R * 0.08, -R * 0.24); ctx.lineTo(-R * 0.08, -R * 0.24); ctx.closePath();
  ctx.fillStyle = C.accent; ctx.fill();
  ctx.restore();
  drawText(ctx, 'N', p[0], p[1] - R * 1.18, { size: R * 0.24, family: S.fontTitle, fill: C.frame, halo: C.paper, haloW: R * 0.05 });
}

function drawFrame(ctx, W, H, C, S) {
  const fw = S.frameWidth;
  if (fw <= 0) return;
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(fw, fw, W - 2 * fw, H - 2 * fw);
  ctx.fillStyle = C.frame; ctx.fill('evenodd');
  if (S.frameStyle === 'ornate') {
    ctx.fillStyle = C.paper;
    const tw = fw * 0.09, gap = fw * 0.3, ins = fw * 0.22;
    for (let x = fw + gap / 2; x < W - fw; x += gap) {
      ctx.fillRect(x, ins, tw, fw - 2 * ins); ctx.fillRect(x, H - fw + ins, tw, fw - 2 * ins);
    }
    for (let y = fw + gap / 2; y < H - fw; y += gap) {
      ctx.fillRect(ins, y, fw - 2 * ins, tw); ctx.fillRect(W - fw + ins, y, fw - 2 * ins, tw);
    }
    for (const [x, y] of [[0, 0], [W - fw, 0], [0, H - fw], [W - fw, H - fw]]) {
      ctx.fillStyle = C.frame; ctx.fillRect(x, y, fw, fw);
      ctx.beginPath(); circle(ctx, [x + fw / 2, y + fw / 2], fw * 0.3);
      ctx.strokeStyle = C.accent; ctx.lineWidth = fw * 0.09; ctx.stroke();
      ctx.beginPath(); circle(ctx, [x + fw / 2, y + fw / 2], fw * 0.08); ctx.fillStyle = C.accent; ctx.fill();
    }
  }
  ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1.5, fw * 0.08);
  const ins = fw + Math.max(4, fw * 0.3);
  ctx.strokeRect(ins, ins, W - 2 * ins, H - 2 * ins);
}

// ---------- main entry ----------
// o: { s, ox, oy, dpr, hits?: [], ref?: {img, opacity, ...} }
export function renderMap(ctx, doc, o) {
  const C = getColors(doc), S = doc.settings, W = doc.meta.width, H = doc.meta.height;
  const k = o.s * o.dpr;
  ctx.setTransform(k, 0, 0, k, o.ox * o.dpr, o.oy * o.dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hits = o.hits || [];
  const feats = doc.features.filter((f) => !f.hidden);
  const shape = new Map();
  for (const f of feats) shape.set(f.id, featureShape(f, doc));
  const walls = feats.filter((f) => f.type === 'wall' && shape.get(f.id).length >= 3);
  const center = walls.length ? G.centroid(shape.get(walls[0].id)) : [W / 2, H / 2];
  const ow = S.outline, gap = +S.featureGap || 0;
  const haloK = S.haloWidth == null ? 0.34 : +S.haloWidth;

  const clipWalls = (list) => (list.length ? (g) => { g.beginPath(); for (const w of list) addPath(g, shape.get(w.id), true); g.clip(); } : null);
  const allWallsClip = clipWalls(walls);
  const clipFor = (f) => {
    if (!f.clipWall) return null;
    if (f.clipWall === 'all') return allWallsClip;
    return clipWalls(walls.filter((w) => w.id === f.clipWall));
  };
  const riverCache = new Map();
  const riverGeo = (f) => { if (!riverCache.has(f.id)) riverCache.set(f.id, riverGeom(f, shape.get(f.id))); return riverCache.get(f.id); };
  const towerCache = new Map();
  const towers = (w) => { if (!towerCache.has(w.id)) towerCache.set(w.id, wallTowers(w, shape.get(w.id))); return towerCache.get(w.id); };
  const cityRoadsAll = feats.filter((f) => f.type === 'road' && f.kind !== 'rural' && shape.get(f.id).length >= 2);

  // Cut "carvers" out of a district layer. ex widens the cut (used for the block
  // layer so a rim of the outline layer shows through as the block outline).
  function carve(g, carvers, ex) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000'; g.fillStyle = '#000';
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const f of carvers) {
      const sh = shape.get(f.id);
      if (f.type === 'road') {
        if (f.kind === 'rural' || sh.length < 2) continue;
        const cl = f.ruralOutside && allWallsClip;
        if (cl) { g.save(); cl(g); }
        g.beginPath(); addPath(g, sh, f.closed);
        g.lineWidth = f.width + 2 * ex; g.stroke();
        if (cl) g.restore();
      } else if (f.type === 'plaza') {
        if (!f.points[0]) continue;
        g.beginPath(); circle(g, f.points[0], f.radius + ex); g.fill();
      } else if (f.type === 'river') {
        if (sh.length < 2) continue;
        g.beginPath(); addPath(g, riverGeo(f).poly, true); g.fill();
        g.lineWidth = 2 * (gap + ex); g.stroke();
      } else if (f.type === 'water' || f.type === 'building') {
        if (sh.length < 3) continue;
        g.beginPath(); addPath(g, sh, true); g.fill();
        g.lineWidth = 2 * (gap + ex); g.stroke();
      } else if (f.type === 'wall') {
        if (sh.length < 3) continue;
        g.beginPath(); addPath(g, sh, true);
        g.lineWidth = f.width + 2 * (gap + ex); g.stroke();
        g.beginPath();
        for (const t of towers(f)) circle(g, t.p, t.r + gap + ex);
        g.fill();
      }
    }
    g.restore();
  }

  function drawDistrictRun(run, above) {
    const items = run.map((d) => ({ d, sh: shape.get(d.id), clip: clipFor(d) })).filter((x) => x.sh.length >= 3);
    if (!items.length) return;
    for (const x of items) x.g = districtGen(x.d, x.sh, center);
    const within = (g, x, fn) => { g.save(); if (x.clip) x.clip(g); fn(); g.restore(); };
    if (S.glow && C.glow) {
      for (const x of items) within(ctx, x, () => {
        ctx.shadowColor = C.glow; ctx.shadowBlur = S.glowSize * k;
        ctx.beginPath(); addPath(ctx, x.sh, true);
        ctx.strokeStyle = C.glow; ctx.lineWidth = S.glowSize * 0.5; ctx.stroke();
      });
    }
    // Outer edge outline (only its outside half survives), then the street-colored ground.
    for (const x of items) within(ctx, x, () => { ctx.beginPath(); addPath(ctx, x.sh, true); ctx.strokeStyle = C.outline; ctx.lineWidth = ow * 2; ctx.stroke(); });
    for (const x of items) within(ctx, x, () => { ctx.beginPath(); addPath(ctx, x.sh, true); ctx.fillStyle = C.street; ctx.fill(); });

    const carvers = above.filter((f) => CARVERS[f.type]);
    for (const ex of [0, ow]) {
      const block = ex > 0;
      const g = getLayer(0, ctx);
      for (const x of items) {
        within(g, x, () => {
          g.beginPath(); addPath(g, x.sh, true); g.clip();
          if (!block) { g.fillStyle = C.outline; g.fill(); }
          else {
            g.fillStyle = x.d.color || toneColor(C, x.d.tone); g.fill();
            if (x.d.hatch && S.hatch && C.hatch) {
              const a = Math.max(0, Math.min(1, (k - 0.35) / 0.8));
              if (a > 0) { g.globalAlpha = a; g.fillStyle = hatchPattern(g, C.hatch, S.hatchSpacing); g.fill(); g.globalAlpha = 1; }
            }
            if (x.g.lots.length) {
              g.beginPath();
              for (const l of x.g.lots) addPath(g, l, false);
              g.strokeStyle = C.outline; g.lineWidth = ow * 0.7; g.globalAlpha = 0.75; g.stroke(); g.globalAlpha = 1;
            }
          }
          g.globalCompositeOperation = 'destination-out';
          g.strokeStyle = '#000'; g.fillStyle = '#000';
          for (const [w, lines] of x.g.buckets) {
            g.beginPath();
            for (const l of lines) addPath(g, l, false);
            g.lineWidth = w + 2 * ex; g.stroke();
          }
          if (x.g.opens.length) {
            g.beginPath();
            for (const p of x.g.opens) addPath(g, p, true);
            g.fill();
            if (ex) { g.lineWidth = 2 * ex; g.stroke(); }
          }
        });
      }
      g.save();
      g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000';
      for (const x of items) {
        if (!(x.d.borderStreet > 0)) continue;
        within(g, x, () => { g.beginPath(); addPath(g, x.sh, true); g.lineWidth = x.d.borderStreet + 2 * ex; g.stroke(); });
      }
      g.restore();
      carve(g, carvers, ex);
      blit(ctx, g);
    }
  }

  function drawRoadRun(run, below) {
    const roads = run.filter((r) => r.type === 'road' && shape.get(r.id).length >= 2);
    const city = roads.filter((r) => r.kind !== 'rural');
    const plazas = run.filter((p) => p.type === 'plaza' && p.points.length);
    const districts = below.filter((f) => f.type === 'district' && shape.get(f.id).length >= 3);
    const lastD = below.map((f) => f.type).lastIndexOf('district');
    const waters = below.slice(lastD + 1).filter((f) => (f.type === 'river' && shape.get(f.id).length >= 2) || (f.type === 'water' && shape.get(f.id).length >= 3));
    const strokeRoads = (g, list, extra) => {
      for (const r of list) {
        const cl = r.ruralOutside && allWallsClip;
        if (cl) { g.save(); cl(g); }
        g.beginPath(); addPath(g, shape.get(r.id), r.closed);
        g.lineWidth = r.width + extra; g.stroke();
        if (cl) g.restore();
      }
    };
    const lines = (g, withRural) => {
      if (withRural) {
        g.strokeStyle = C.ruralRoad;
        for (const r of roads) {
          const rural = r.kind === 'rural';
          if (!rural && !(r.ruralOutside && walls.length)) continue;
          g.beginPath(); addPath(g, shape.get(r.id), r.closed);
          g.lineWidth = rural ? Math.max(1.2, r.width * 0.25) : Math.max(1.4, r.width * 0.16);
          g.stroke();
        }
      }
      g.strokeStyle = C.outline; g.fillStyle = C.outline;
      strokeRoads(g, city, ow * 2);
      g.beginPath();
      for (const p of plazas) circle(g, p.points[0], p.radius + ow);
      g.fill();
    };
    if (!districts.length) lines(ctx, true);
    else {
      // Inside districts the blocks already carry the outline, so road edges are masked out there...
      const g = getLayer(1, ctx);
      lines(g, true);
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
      for (const d of districts) {
        g.save(); const cl = clipFor(d); if (cl) cl(g);
        g.beginPath(); addPath(g, shape.get(d.id), true); g.fill();
        g.restore();
      }
      g.globalCompositeOperation = 'source-over';
      blit(ctx, g);
      // ...except where a road bridges water that sits above the districts.
      if (waters.length) {
        const g2 = getLayer(1, ctx);
        lines(g2, false);
        g2.globalCompositeOperation = 'destination-in'; g2.fillStyle = '#000';
        g2.beginPath();
        for (const f of waters) addPath(g2, f.type === 'river' ? riverGeo(f).poly : shape.get(f.id), true);
        g2.fill();
        blit(ctx, g2);
      }
    }
    ctx.strokeStyle = C.street; ctx.fillStyle = C.street;
    strokeRoads(ctx, city, 0);
    ctx.beginPath();
    for (const p of plazas) circle(ctx, p.points[0], p.radius);
    ctx.fill();
    for (const p of plazas) drawMonument(ctx, p, C, S);
  }

  function drawFarm(f, sh) {
    if (sh.length < 3) return;
    const g = farmGen(f, sh, center);
    const tints = [C.farm1, C.farm2, C.farm3];
    ctx.save();
    const cl = clipFor(f);
    if (cl) cl(ctx);
    ctx.beginPath(); addPath(ctx, sh, true); ctx.clip();
    ctx.fillStyle = C.farm1; ctx.fill();
    g.leaves.forEach((p, i) => {
      const rnd = mulberry32(hashStr(f.seed + ':' + i));
      ctx.beginPath(); addPath(ctx, p, true);
      ctx.fillStyle = tints[Math.floor(rnd() * 3)]; ctx.fill();
      if (!f.furrows || rnd() < 0.15) return;
      ctx.save(); ctx.clip();
      const b = G.bbox(p), c = G.centroid(p);
      let best = 0, d = [1, 0];
      for (let a = 0; a < 8; a++) { const v = G.fromAngle((a * Math.PI) / 8); const e = G.extentAlong(p, v); if (e[1] - e[0] > best) { best = e[1] - e[0]; d = v; } }
      if (rnd() < 0.3) d = G.perp(d);
      const n = G.perp(d), R = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + 2;
      const sp = Math.max(2, +f.furrowSpacing || 6);
      ctx.beginPath();
      for (let s = -R; s <= R; s += sp) {
        const a0 = G.add(c, G.add(G.scale(n, s), G.scale(d, -R))), a1 = G.add(c, G.add(G.scale(n, s), G.scale(d, R)));
        ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]);
      }
      ctx.strokeStyle = C.farmLine; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.restore();
    });
    if (f.hedges) {
      ctx.beginPath();
      for (const [, ls] of g.buckets) for (const l of ls) addPath(ctx, l, false);
      ctx.strokeStyle = C.hedge; ctx.lineWidth = 3.2; ctx.setLineDash([0.1, 4.2]); ctx.stroke();
      ctx.lineWidth = 0.8; ctx.setLineDash([]); ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    if (cl) cl(ctx);
    ctx.beginPath(); addPath(ctx, sh, true);
    ctx.strokeStyle = C.hedge; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  }

  function drawWall(w) {
    const sh = shape.get(w.id);
    ctx.beginPath(); addPath(ctx, sh, true);
    ctx.strokeStyle = C.wall; ctx.lineWidth = w.width; ctx.stroke();
    ctx.beginPath();
    for (const t of towers(w)) circle(ctx, t.p, t.r);
    ctx.fillStyle = C.wall; ctx.fill();
    if (!w.gates) return;
    for (const r of cityRoadsAll) {
      if (!r.gates) continue;
      for (const x of G.pathIntersections(shape.get(r.id), r.closed, sh, true)) {
        const L = w.width + w.towerSize * 2 + 4;
        const a = G.sub(x.p, G.scale(x.dirA, L)), b = G.add(x.p, G.scale(x.dirA, L));
        ctx.lineCap = 'butt';
        for (const pass of [0, 1]) {
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          ctx.strokeStyle = pass ? C.street : C.outline;
          ctx.lineWidth = pass ? r.width : r.width + ow * 2;
          ctx.stroke();
        }
        ctx.lineCap = 'round';
        const ts = Math.max(3, w.towerSize * 1.3), off = r.width / 2 + ts * 0.9;
        ctx.beginPath();
        circle(ctx, G.add(x.p, G.scale(x.dirB, off)), ts);
        circle(ctx, G.sub(x.p, G.scale(x.dirB, off)), ts);
        ctx.fillStyle = C.wall; ctx.fill();
      }
    }
  }

  const fam = (key) => S[key] || 'Cinzel';
  function drawSingle(f) {
    const sh = shape.get(f.id);
    switch (f.type) {
      case 'farm': drawFarm(f, sh); break;
      case 'water': if (sh.length >= 3) drawWater(ctx, f, sh, C); break;
      case 'river': if (sh.length >= 2) drawRiver(ctx, f, sh, riverGeo(f), C); break;
      case 'building':
        if (sh.length < 3) break;
        ctx.beginPath(); addPath(ctx, sh, true);
        ctx.fillStyle = { solid: C.outline, light: C.street, block: C.block, accent: C.accent, water: C.water, park: C.park }[f.style] || C.outline;
        ctx.fill();
        ctx.strokeStyle = C.outline; ctx.lineWidth = ow * 1.3; ctx.stroke();
        break;
      case 'wall': if (sh.length >= 3) drawWall(f); break;
      case 'landmark': {
        const c = f.points[0];
        if (!c) break;
        ctx.beginPath(); circle(ctx, c, f.size);
        ctx.fillStyle = C.accent; ctx.fill();
        ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, f.size * 0.25); ctx.stroke();
        if (f.showLabel && f.name) {
          const p = G.add(c, f.labelOffset || [0, 0]);
          const poly = drawText(ctx, f.name, p[0], p[1], {
            size: f.labelSize, spacing: 0.06, family: fam('fontLabel'), upper: true, fill: C.label, halo: C.labelHalo, haloW: f.labelSize * haloK,
          });
          if (poly) hits.push({ id: f.id, kind: 'offset', poly });
        }
        break;
      }
      case 'label': {
        const c = f.points[0];
        if (!c) break;
        const st = LABEL_STYLES[f.style] || LABEL_STYLES.district;
        const poly = drawText(ctx, f.text, c[0], c[1], {
          size: f.size, angle: f.angle, spacing: f.spacing, family: fam(st.font), upper: st.upper, italic: st.italic,
          fill: f.color || C[st.fill], halo: st.halo ? C[st.halo] : null, haloW: f.size * haloK,
          boxed: st.boxed, boxFill: C.paper, boxStroke: C.frame,
        });
        if (poly) hits.push({ id: f.id, kind: 'move', poly });
        break;
      }
      case 'compass': if (f.points[0]) drawCompass(ctx, f.points[0], f.size, C, S); break;
      default: break;
    }
  }

  // ---- paint ----
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  if (S.fields) {
    ctx.beginPath();
    for (const l of fieldsGen(W, H, S.fieldSize, S.seed)) addPath(ctx, l, false);
    ctx.strokeStyle = C.field; ctx.lineWidth = 1.1; ctx.stroke();
  }
  const isRoadish = (f) => f.type === 'road' || f.type === 'plaza';
  for (let i = 0; i < feats.length;) {
    const f = feats[i];
    let j = i + 1;
    if (f.type === 'district') {
      while (j < feats.length && feats[j].type === 'district') j++;
      drawDistrictRun(feats.slice(i, j), feats.slice(j));
    } else if (isRoadish(f)) {
      while (j < feats.length && isRoadish(feats[j])) j++;
      drawRoadRun(feats.slice(i, j), feats.slice(0, i));
    } else drawSingle(f);
    i = j;
  }

  // Area and river names always sit on top so they stay readable.
  for (const f of feats) {
    if (!['district', 'water', 'farm'].includes(f.type) || !f.showLabel || !f.name) continue;
    const sh = shape.get(f.id);
    if (sh.length < 3) continue;
    const c = G.add(G.centroid(sh), f.labelOffset || [0, 0]);
    const water = f.type === 'water';
    const poly = drawText(ctx, f.name, c[0], c[1], {
      size: f.labelSize, angle: f.labelAngle, spacing: f.labelSpacing, family: fam('fontLabel'), upper: true,
      fill: water ? C.waterText : C.label, halo: water ? C.waterHalo : C.labelHalo, haloW: f.labelSize * haloK,
    });
    if (poly) hits.push({ id: f.id, kind: 'offset', poly });
  }
  for (const f of feats) {
    if (f.type !== 'river' || !f.showLabel || !f.name) continue;
    const poly = drawTextOnPath(ctx, shape.get(f.id), f.name, {
      pos: f.labelPos, size: f.labelSize, spacing: f.labelSpacing, family: fam('fontLabel'), fill: C.waterText, halo: C.waterHalo, haloW: f.labelSize * haloK,
    });
    if (poly) hits.push({ id: f.id, kind: 'pathpos', poly });
  }

  if (o.ref && o.ref.img && o.ref.visible) {
    ctx.globalAlpha = o.ref.opacity;
    const r = o.ref, iw = r.img.width * r.scale, ih = r.img.height * r.scale;
    ctx.drawImage(r.img, r.x, r.y, iw, ih);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (S.frame) drawFrame(ctx, W, H, C, S);
}
