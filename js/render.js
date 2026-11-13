// Draws a map document onto a 2D canvas. Used for both the editor view and PNG export.
//
// Features are drawn in document order (the Layers tab). Districts are composed
// in offscreen layers so that anything above them (roads, plazas, rivers, lakes,
// walls, buildings) CUTS into the blocks rather than being painted on top: the
// block outlines then wrap neatly around every street, plaza and riverbank.

import * as G from './geom.js';
import { districtGen, farmGen, fieldsGen, prepGuides } from './generate.js';
import { THEMES, FONT_WEIGHTS } from './themes.js';
import { makeNoise, hashStr, mulberry32 } from './rng.js';

export function getColors(doc) {
  const t = THEMES[doc.settings.theme] || THEMES.patina;
  const c = { ...t.colors };
  for (const [k, v] of Object.entries(doc.settings.colors || {})) if (v) c[k] = v;
  return c;
}

const CLOSED = { district: 1, farm: 1, water: 1, building: 1, cutout: 1 };
const POINT_TYPES = { plaza: 1, landmark: 1, label: 1, compass: 1 };
const CARVERS = { road: 1, plaza: 1, river: 1, water: 1, wall: 1, building: 1, cutout: 1 };
export const isClosed = (f) => (f.type === 'wall' ? f.closed !== false : !!CLOSED[f.type] || (f.type === 'road' && !!f.closed));
export const isPointType = (f) => !!POINT_TYPES[f.type];

// Closed walls only: open wall segments can't enclose or be followed by a district.
export function findWalls(doc) {
  return doc.features.filter((f) => f.type === 'wall' && !f.hidden && f.closed !== false && f.points.length >= 3);
}

// Corners of a square / rectangular plaza (grow expands it on every side).
export function plazaCorners(p, grow = 0) {
  const c = p.points[0], a = ((p.angle || 0) * Math.PI) / 180;
  const hw = p.radius * (p.aspect || 1) + grow, hh = p.radius + grow;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map((q) => G.add(G.rotate(q, a), c));
}
function plazaPath(g, p, grow) {
  if (p.shape === 'square') addPath(g, plazaCorners(p, grow), true);
  else circle(g, p.points[0], p.radius + grow);
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
  const alpha = o.alpha == null ? 1 : o.alpha;
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
  ctx.globalAlpha = alpha;
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
  street: { name: 'Street name (small, runs along a road)', font: 'fontLabel', fill: 'outline', halo: 'street', upper: true },
  water: { name: 'Water', font: 'fontLabel', fill: 'waterText', halo: 'waterHalo', upper: true },
  ink: { name: 'Plain ink', font: 'fontLabel', fill: 'outline', halo: null, upper: false },
  script: { name: 'Script (italic)', font: 'fontScript', fill: 'outline', halo: 'labelHalo', upper: false, italic: true },
  title: { name: 'Title box', font: 'fontTitle', fill: 'accent', halo: null, upper: true, boxed: true },
};

// ---------- geometry caches per render ----------
function toneColor(C, tone) {
  return tone === 'dark' ? C.blockDark : tone === 'light' ? C.blockLight : tone === 'park' ? C.park : C.block;
}

function mixColor(a, b, t) {
  const pa = /^#([0-9a-f]{6})$/i.exec(a || ''), pb = /^#([0-9a-f]{6})$/i.exec(b || '');
  if (!pa || !pb) return a;
  const ch = (s, i) => parseInt(s.slice(i, i + 2), 16);
  const m = (i) => Math.round(ch(pa[1], i) * (1 - t) + ch(pb[1], i) * t).toString(16).padStart(2, '0');
  return '#' + m(0) + m(2) + m(4);
}
const lawnColor = (C) => mixColor(C.park, C.paper, 0.5);

function drawTrees(g, trees, C) {
  if (!trees.length) return;
  g.beginPath();
  for (const [x, y, r] of trees) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
  g.fillStyle = C.park; g.fill();
  g.strokeStyle = C.outline; g.globalAlpha = 0.75; g.lineWidth = 0.8; g.stroke(); g.globalAlpha = 1;
  g.beginPath();
  for (const [x, y, r] of trees) { const hr = r * 0.42; g.moveTo(x - r * 0.3 + hr, y - r * 0.3); g.arc(x - r * 0.3, y - r * 0.3, hr, 0, Math.PI * 2); }
  g.fillStyle = mixColor(C.park, C.paper, 0.4); g.fill();
}

function drawGraves(g, graves, C, S) {
  if (!graves.length) return;
  g.beginPath();
  for (const [x, y, a, w, h] of graves) {
    const c = Math.cos(a), s = Math.sin(a);
    const q = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((p) => [x + p[0] * c - p[1] * s, y + p[0] * s + p[1] * c]);
    g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.closePath();
  }
  g.fillStyle = C.street; g.fill();
  g.strokeStyle = C.outline; g.globalAlpha = 0.8; g.lineWidth = Math.max(0.5, S.outline * 0.55); g.stroke(); g.globalAlpha = 1;
}

export function riverGeom(f, sh) {
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
  const closed = w.closed !== false;
  const step = Math.max(10, +w.towerSpacing || 60);
  if (w.towerSize <= 0 || sh.length < (closed ? 3 : 2)) return out;
  if (w.cornerTowers !== false && !w.smooth) {
    const P = w.points, n = P.length;
    for (let i = 0; i < n; i++) {
      const b = P[i];
      // The two ends of an open wall always get a tower.
      if (closed || (i > 0 && i < n - 1)) {
        const a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
        const d1 = G.norm(G.sub(b, a)), d2 = G.norm(G.sub(c, b));
        const turn = Math.acos(Math.max(-1, Math.min(1, G.dot(d1, d2))));
        if (turn < 0.45) continue;
      }
      if (out.some((t) => G.dist(t.p, b) < step * 0.5)) continue;
      out.push({ p: b, r: w.towerSize * 1.4 });
    }
  }
  const path = closed ? sh.concat([sh[0]]) : sh;
  const cum = G.cumLengths(path), L = cum[cum.length - 1];
  const count = Math.max(1, Math.round(L / step)), real = L / count;
  const upto = closed ? count : count + 1;
  for (let i = 0; i < upto; i++) {
    const p = G.pointAt(path, cum, i * real).p;
    if (out.some((t) => G.dist(t.p, p) < real * 0.6)) continue;
    out.push({ p, r: w.towerSize });
  }
  return out;
}

// ---------- feature painters ----------
// Irregular water texture: scattered short ripple strokes that clump and thin out with
// distance from the shore, plus broken, wavering lines that follow the coast. Generated
// once per lake shape and cached (it is rebuilt only when the shape changes).
const lakeCache = new Map();
function lakeTexture(f, sh) {
  const key = f.id + '|' + sh.length + '|' + Math.round(G.polyArea(sh)) + '|' + Math.round(sh[0][0]) + ',' + Math.round(sh[0][1]);
  if (lakeCache.has(key)) return lakeCache.get(key);
  if (lakeCache.size > 40) lakeCache.clear();
  const seed = hashStr(f.id);
  const rnd = mulberry32(seed ^ 0x1a4e), nz = makeNoise(seed ^ 0x99);
  const bb = G.bbox(sh), area = Math.abs(G.polyArea(sh));
  const want = Math.min(2600, Math.round(area / 380));
  const tiers = [[], [], []];
  let placed = 0, tries = 0;
  while (placed < want && tries < want * 8) {
    tries++;
    const p = [bb.x0 + rnd() * (bb.x1 - bb.x0), bb.y0 + rnd() * (bb.y1 - bb.y0)];
    if (!G.pointInPoly(p, sh)) continue;
    const d = G.nearestOnPath(p, sh, true).d;
    const clump = 0.35 + 0.65 * ((nz(p[0] / 140, p[1] / 140) + 1) / 2);
    if (rnd() > (0.2 + 0.8 * Math.exp(-d / 80)) * clump) continue;
    const len = 5 + rnd() * rnd() * 36;
    const ang = (rnd() - 0.5) * 0.3 + nz(p[0] / 260 + 5, p[1] / 260) * 0.45;
    tiers[rnd() < 0.5 ? 0 : rnd() < 0.7 ? 1 : 2].push([p[0], p[1], len, ang]);
    placed++;
  }
  // Coast-following lines, jittered and dashed irregularly.
  const baseArea = G.polyArea(sh), shore = [];
  [14, 27, 44, 66].forEach((d, k) => {
    const off = G.inflatePoly(sh, -d);
    const a = G.polyArea(off);
    if (Math.sign(a) !== Math.sign(baseArea) || Math.abs(a) < Math.abs(baseArea) * 0.25) return;
    const pts = off.map((p, i) => [p[0] + nz(i / 6, k * 4.1) * 2.4, p[1] + nz(i / 6 + 50, k * 4.1) * 2.4]);
    const dash = [];
    for (let i = 0; i < 6; i++) dash.push(i % 2 ? 6 + rnd() * 30 : 18 + rnd() * 70);
    shore.push({ pts, dash, alpha: 0.6 - k * 0.12, offset: rnd() * 200 });
  });
  const out = { tiers, shore };
  lakeCache.set(key, out);
  return out;
}

function drawLakeTexture(ctx, f, sh, C) {
  const t = lakeTexture(f, sh);
  ctx.strokeStyle = C.waterLine;
  ctx.lineCap = 'round';
  [0.75, 0.5, 0.3].forEach((alpha, i) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = i === 0 ? 1.2 : 0.9;
    ctx.beginPath();
    for (const [x, y, len, a] of t.tiers[i]) { ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); }
    ctx.stroke();
  });
  ctx.lineWidth = 1;
  for (const s of t.shore) {
    ctx.globalAlpha = s.alpha; ctx.setLineDash(s.dash); ctx.lineDashOffset = s.offset;
    ctx.beginPath(); addPath(ctx, s.pts, true); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function drawWater(ctx, f, sh, C, riverPolys) {
  ctx.save();
  ctx.beginPath(); addPath(ctx, sh, true);
  ctx.fillStyle = C.water; ctx.fill();
  ctx.clip();
  drawLakeTexture(ctx, f, sh, C);
  ctx.restore();
  // Shore rings and the edge line go on their own layer so rivers can open into the
  // lake: both are erased wherever a river's channel meets the shore.
  const g = getLayer(2, ctx);
  const gap = 9;
  g.save();
  g.beginPath(); addPath(g, sh, true); g.clip();
  for (let i = f.coastLines; i >= 1; i--) {
    g.beginPath(); addPath(g, sh, true);
    g.strokeStyle = C.waterLine; g.lineWidth = 2 * i * gap + 1.2; g.stroke();
    g.strokeStyle = C.water; g.lineWidth = 2 * i * gap - 1.2; g.stroke();
  }
  g.restore();
  if (f.border !== false) {
    g.beginPath(); addPath(g, sh, true);
    g.strokeStyle = C.waterEdge; g.lineWidth = 2; g.stroke();
  }
  if (riverPolys.length) {
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 3;
    for (const poly of riverPolys) { g.beginPath(); addPath(g, poly, true); g.fill(); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  }
  blit(ctx, g);
}

function drawRiver(target, f, sh, geo, C, lakes) {
  if (sh.length < 2) return;
  const { L, R, wl, wr, nrm, cum, poly } = geo;
  // Drawn on a layer so the part inside any lake can be removed (the lake shows instead).
  const ctx = lakes.length ? getLayer(2, target) : target;
  ctx.save();
  ctx.beginPath(); addPath(ctx, poly, true);
  ctx.fillStyle = C.water; ctx.fill();
  ctx.clip();
  ctx.strokeStyle = C.waterLine; ctx.lineWidth = 1;
  if (f.canal) {
    // Short, broken, slightly wavering ripple strokes at random depths in the channel.
    const rnd = mulberry32(hashStr(f.id) ^ 0x51ab);
    const nz = makeNoise(hashStr(f.id) ^ 0x2b7);
    const total = cum[cum.length - 1], half = f.width / 2;
    const lanes = Math.max(2, Math.round(f.width / 6));
    ctx.lineCap = 'round';
    for (let k = 0; k < lanes; k++) {
      const lat0 = -0.7 + (1.4 * (k + 0.5)) / lanes + (rnd() - 0.5) * 0.3;
      let s = rnd() * 30;
      while (s < total) {
        const len = 4 + rnd() * 16;
        ctx.beginPath();
        for (let u = 0; u <= len; u += 2.5) {
          const at = G.pointAt(sh, cum, Math.min(total, s + u));
          const nrmv = G.perp(at.dir);
          const off = (lat0 + nz((s + u) / 18, k * 5.7) * 0.18) * half;
          const x = at.p[0] + nrmv[0] * off, y = at.p[1] + nrmv[1] * off;
          if (u) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.globalAlpha = 0.35 + rnd() * 0.55;
        ctx.lineWidth = 0.7 + rnd() * 0.7;
        ctx.stroke();
        s += len + 6 + rnd() * 34;
      }
    }
    ctx.globalAlpha = 1;
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
  if (f.border !== false) {
    ctx.beginPath(); addPath(ctx, L, false); addPath(ctx, R, false);
    ctx.strokeStyle = C.waterEdge; ctx.lineWidth = f.canal ? 2.4 : 1.8; ctx.stroke();
  }
  if (ctx !== target) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const lake of lakes) { ctx.beginPath(); addPath(ctx, lake, true); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    blit(target, ctx);
  }
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
    case 'market': {
      // Small stalls (squares and rectangles) laid out in loose rows across the plaza.
      const rnd = mulberry32(hashStr(p.id));
      const sq = p.shape === 'square';
      const a = sq ? ((p.angle || 0) * Math.PI) / 180 : 0;
      const hw = sq ? r * (p.aspect || 1) : r, hh = r;
      const step = Math.max(6, r * 0.3);
      const nx = Math.max(1, Math.floor((hw * 1.56) / step) + 1), ny = Math.max(1, Math.floor((hh * 1.56) / step) + 1);
      ctx.fillStyle = C.block; ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(0.8, S.outline * 0.8);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const gx = (i - (nx - 1) / 2) * step, gy = (j - (ny - 1) / 2) * step;
          if (!sq && Math.hypot(gx, gy) > r * 0.74) continue;
          if (rnd() < 0.2) continue;
          const horiz = rnd() < 0.5, w = step * (horiz ? 0.72 : 0.46), h = step * (horiz ? 0.46 : 0.72);
          const rot = a + (sq ? 0 : (rnd() - 0.5) * 0.35);
          const ctr = G.add(G.rotate([gx, gy], a), c);
          const quad = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((q) => G.add(G.rotate(q, rot), ctr));
          ctx.beginPath(); addPath(ctx, quad, true); ctx.fill(); ctx.stroke();
        }
      }
      break;
    }
    default: break;
  }
}

// A classic faceted compass rose: thin double ring, short intercardinal points,
// long cardinal points (north in the accent colour), each split into a dark and a light half.
function drawCompass(ctx, f, C, S) {
  const p = f.points[0], R = f.size, deg = f.angle || 0, ang = (deg * Math.PI) / 180;
  const lw = Math.max(0.8, R * 0.016);
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(ang);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.frame;
  ctx.lineWidth = lw * 1.8;
  ctx.beginPath(); circle(ctx, [0, 0], R * 0.64); ctx.stroke();
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath(); circle(ctx, [0, 0], R * 0.58); ctx.stroke();
  const star = (len, wid, base, darkOf) => {
    for (let i = 0; i < 4; i++) {
      const a = base + (i * Math.PI) / 2;
      const tip = [Math.cos(a) * len, Math.sin(a) * len];
      const s1 = [Math.cos(a - Math.PI / 4) * wid, Math.sin(a - Math.PI / 4) * wid];
      const s2 = [Math.cos(a + Math.PI / 4) * wid, Math.sin(a + Math.PI / 4) * wid];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s1[0], s1[1]); ctx.lineTo(tip[0], tip[1]); ctx.closePath();
      ctx.fillStyle = darkOf(i); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(s2[0], s2[1]); ctx.closePath();
      ctx.fillStyle = C.paper; ctx.fill();
      ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(s2[0], s2[1]); ctx.lineTo(0, 0); ctx.closePath();
      ctx.lineWidth = lw; ctx.stroke();
    }
  };
  star(R * 0.5, R * 0.12, -Math.PI / 4, () => C.frame);
  star(R, R * 0.17, -Math.PI / 2, (i) => (i === 0 ? C.accent : C.frame));
  ctx.beginPath(); circle(ctx, [0, 0], R * 0.045); ctx.fillStyle = C.frame; ctx.fill();
  ctx.restore();
  const np = G.add(p, G.rotate([0, -R * 1.22], ang));
  drawText(ctx, 'N', np[0], np[1], { size: R * 0.28, angle: deg, family: S.fontTitle, fill: C.frame, halo: C.paper, haloW: R * 0.07 });
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
  if (!ctx.canvas.width || !ctx.canvas.height) return;   // not laid out yet
  const C = getColors(doc), S = doc.settings, W = doc.meta.width, H = doc.meta.height;
  const k = o.s * o.dpr;
  ctx.setTransform(k, 0, 0, k, o.ox * o.dpr, o.oy * o.dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hits = o.hits || [];
  const feats = doc.features.filter((f) => !f.hidden);
  const shape = new Map();
  for (const f of feats) shape.set(f.id, featureShape(f, doc));
  // `walls` = closed walls (they can enclose, clip and be followed); open wall segments are drawn but do none of that.
  const walls = feats.filter((f) => f.type === 'wall' && f.closed !== false && shape.get(f.id).length >= 3);
  const center = walls.length ? G.centroid(shape.get(walls[0].id)) : [W / 2, H / 2];
  const ow = S.outline, gap = +S.featureGap || 0;
  const haloK = S.haloWidth == null ? 0.34 : +S.haloWidth;
  const haloOf = (f) => (f.halo == null ? haloK : +f.halo);

  const clipWalls = (list) => (list.length ? (g) => { g.beginPath(); for (const w of list) addPath(g, shape.get(w.id), true); g.clip(); } : null);
  const allWallsClip = clipWalls(walls);
  const clipFor = (f) => {
    if (!f.clipWall) return null;
    if (f.clipWall === 'all') return allWallsClip;
    return clipWalls(walls.filter((w) => w.id === f.clipWall));
  };
  const riverCache = new Map();
  const riverGeo = (f) => { if (!riverCache.has(f.id)) riverCache.set(f.id, riverGeom(f, shape.get(f.id))); return riverCache.get(f.id); };
  // Roads and rivers that nearby generated streets line up with.
  let guidesCache = null;
  const getGuides = () => guidesCache || (guidesCache = prepGuides(
    feats.filter((f) => (f.type === 'road' && f.kind !== 'rural' && f.steer !== false && f.carve !== false) || f.type === 'river').map((f) => shape.get(f.id)).filter((s) => s.length >= 2)));
  let riverPolysCache = null;
  const riverPolys = () => riverPolysCache || (riverPolysCache = feats.filter((f) => f.type === 'river' && shape.get(f.id).length >= 2).map((f) => riverGeo(f).poly));
  // Slightly inset so a river's fill overlaps the lake's fill by a hair (no antialiasing line where they meet).
  const lakeShapes = feats.filter((f) => f.type === 'water' && shape.get(f.id).length >= 3).map((f) => G.inflatePoly(shape.get(f.id), -1));
  const towerCache = new Map();
  const towers = (w) => { if (!towerCache.has(w.id)) towerCache.set(w.id, wallTowers(w, shape.get(w.id))); return towerCache.get(w.id); };
  const cityRoadsAll = feats.filter((f) => f.type === 'road' && f.kind !== 'rural' && shape.get(f.id).length >= 2);
  const allPlazas = feats.filter((f) => f.type === 'plaza' && f.points[0]);

  // Cut "carvers" out of a district layer. ex widens the cut (used for the block
  // layer so a rim of the outline layer shows through as the block outline).
  function carve(g, carvers, exAll) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000'; g.fillStyle = '#000';
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const f of carvers) {
      // Shapes with their dark border turned off get no outline rim where they cut into the blocks.
      const ex = f.border === false ? 0 : exAll;
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
        g.beginPath(); plazaPath(g, f, ex); g.fill();
      } else if (f.type === 'river') {
        if (sh.length < 2) continue;
        g.beginPath(); addPath(g, riverGeo(f).poly, true); g.fill();
        { const gr = f.gap == null ? gap : +f.gap; if (gr + ex > 0) { g.lineWidth = 2 * (gr + ex); g.stroke(); } }
      } else if (f.type === 'water' || f.type === 'building' || f.type === 'cutout') {
        if (sh.length < 3) continue;
        const gp = f.type === 'cutout' ? +f.gap || 0 : (f.gap == null ? gap : +f.gap);
        g.beginPath(); addPath(g, sh, true); g.fill();
        if (gp + ex > 0) { g.lineWidth = 2 * (gp + ex); g.stroke(); }
      } else if (f.type === 'wall') {
        if (sh.length < (f.closed === false ? 2 : 3)) continue;
        g.beginPath(); addPath(g, sh, f.closed !== false);
        const gw = f.gap == null ? gap : +f.gap;
        g.lineWidth = f.width + 2 * (gw + ex); g.stroke();
        g.beginPath();
        for (const t of towers(f)) circle(g, t.p, t.r + gw + ex);
        g.fill();
      }
    }
    g.restore();
  }

  function drawDistrictRun(run, above) {
    const items = run.map((d) => ({ d, sh: shape.get(d.id), clip: clipFor(d) })).filter((x) => x.sh.length >= 3);
    // Clip with a hair-wider outline so abutting districts overlap slightly and no antialiasing seam shows between them.
    for (const x of items) x.cs = G.inflatePoly(x.sh, 0.9);
    if (!items.length) return;
    for (const x of items) x.g = districtGen(x.d, x.sh, center, x.d.alignRoads ? getGuides() : null);
    const within = (g, x, fn) => { g.save(); if (x.clip) x.clip(g); fn(); g.restore(); };
    if (S.glow && C.glow) {
      for (const x of items) within(ctx, x, () => {
        ctx.shadowColor = C.glow; ctx.shadowBlur = S.glowSize * k;
        ctx.beginPath(); addPath(ctx, x.sh, true);
        ctx.strokeStyle = C.glow; ctx.lineWidth = S.glowSize * 0.5; ctx.stroke();
      });
    }
    // Outer edge outline (only its outside half survives), then the street-colored ground.
    for (const x of items) { if (x.d.border === false) continue; within(ctx, x, () => { ctx.beginPath(); addPath(ctx, x.sh, true); ctx.strokeStyle = C.outline; ctx.lineWidth = ow * 2; ctx.stroke(); }); }
    // One fill per wall-clip group, so neighbouring districts form a single shape with no hairline between them.
    // Cut-aways above the districts are erased from it so the hole really is open.
    const carvers = above.filter((f) => CARVERS[f.type]);
    const cutouts = carvers.filter((f) => f.type === 'cutout' && shape.get(f.id).length >= 3);
    const groups = new Map();
    for (const x of items) { const key = String(x.d.clipWall || ''); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(x); }
    for (const list of groups.values()) {
      const gg = getLayer(0, ctx);
      gg.save();
      if (list[0].clip) list[0].clip(gg);
      gg.beginPath();
      for (const x of list) addPath(gg, x.cs, true);
      gg.fillStyle = C.street; gg.fill();
      gg.restore();
      if (cutouts.length) {
        gg.globalCompositeOperation = 'destination-out'; gg.fillStyle = '#000';
        for (const c of cutouts) { gg.beginPath(); addPath(gg, shape.get(c.id), true); gg.fill(); }
        gg.globalCompositeOperation = 'source-over';
      }
      blit(ctx, gg);
    }

    for (const ex of [0, ow]) {
      const block = ex > 0;
      const g = getLayer(0, ctx);
      for (const x of items) {
        within(g, x, () => {
          g.beginPath(); addPath(g, x.cs, true); g.clip();
          if (!block) { g.fillStyle = x.d.border === false ? (x.d.color || ((x.d.look || 'blocks') !== 'blocks' ? lawnColor(C) : toneColor(C, x.d.tone))) : C.outline; g.fill(); }
          else {
            const look = x.d.look || 'blocks';
            g.fillStyle = x.d.color || (look !== 'blocks' ? lawnColor(C) : toneColor(C, x.d.tone)); g.fill();
            if (look === 'blocks' && x.d.hatch && S.hatch && C.hatch) {
              const a = Math.max(0, Math.min(1, (k - 0.35) / 0.8));
              if (a > 0) { g.globalAlpha = a; g.fillStyle = hatchPattern(g, C.hatch, S.hatchSpacing); g.fill(); g.globalAlpha = 1; }
            }
            if (x.g.lots.length) {
              g.beginPath();
              for (const l of x.g.lots) addPath(g, l, false);
              g.strokeStyle = C.outline; g.lineWidth = ow * 0.7; g.globalAlpha = 0.75; g.stroke(); g.globalAlpha = 1;
            }
            // Trees / headstones are painted before the streets are cut, so paths and roads stay clear.
            if (look === 'garden' && x.g.decor) drawTrees(g, x.g.decor.trees, C);
            else if (look === 'cemetery' && x.g.decor) drawGraves(g, x.g.decor.graves, C, S);
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
    const masked = city;
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
      strokeRoads(g, masked.filter((r) => r.border !== false), ow * 2);
      g.beginPath();
      for (const p of plazas) if (p.border !== false) plazaPath(g, p, ow);
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
    strokeRoads(ctx, masked, 0);
    ctx.beginPath();
    for (const p of plazas) plazaPath(ctx, p, 0);
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
    const wClosed = w.closed !== false;
    // Gates: where a gated road crosses this wall.
    const gates = [];
    if (w.gates) {
      for (const r of cityRoadsAll) {
        if (!r.gates) continue;
        for (const x of G.pathIntersections(shape.get(r.id), r.closed, sh, wClosed)) {
          const sinT = Math.max(0.35, Math.abs(x.dirA[0] * x.dirB[1] - x.dirA[1] * x.dirB[0]));
          gates.push({ r, x, sinT, half: r.width / 2 / sinT });
        }
      }
    }
    // Towers, minus any that would stand in a gate opening.
    const tw = towers(w).filter((t) => !gates.some((g) => G.dist(t.p, g.x.p) < g.half + t.r));
    const strokeWall = (g) => { g.beginPath(); addPath(g, sh, wClosed); g.lineWidth = w.width; g.stroke(); };
    if (!gates.length) {
      ctx.strokeStyle = C.wall; strokeWall(ctx);
      ctx.beginPath(); for (const t of tw) circle(ctx, t.p, t.r);
      ctx.fillStyle = C.wall; ctx.fill();
      return;
    }
    // The wall is drawn on a layer and each gate is cut straight through it along the road, so the
    // opening's sides run parallel to the road and its ends are flush with the wall's own faces.
    const seg = (g, x, sinT, len) => {
      const L = (w.width / 2 + len) / sinT;
      const a = G.sub(x.p, G.scale(x.dirA, L)), b = G.add(x.p, G.scale(x.dirA, L));
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    };
    const wl = getLayer(2, ctx);
    wl.strokeStyle = C.wall; strokeWall(wl);
    wl.beginPath(); for (const t of tw) circle(wl, t.p, t.r);
    wl.fillStyle = C.wall; wl.fill();
    wl.globalCompositeOperation = 'destination-out'; wl.lineCap = 'butt'; wl.strokeStyle = '#000';
    for (const { r, x, sinT } of gates) { seg(wl, x, sinT, 3); wl.lineWidth = r.width; wl.stroke(); }
    wl.globalCompositeOperation = 'source-over'; wl.lineCap = 'round';
    blit(ctx, wl);
    // Passage floor: plain road color between the towers, no outlines, kept to the wall's thickness.
    const gl = getLayer(2, ctx);
    gl.lineCap = 'butt';
    for (const { r, x, sinT } of gates) { seg(gl, x, sinT, 12); gl.strokeStyle = C.street; gl.lineWidth = r.width + 0.5; gl.stroke(); }
    gl.globalCompositeOperation = 'destination-in';
    gl.strokeStyle = '#000'; strokeWall(gl);
    gl.globalCompositeOperation = 'source-over'; gl.lineCap = 'round';
    blit(ctx, gl);
    // Gate towers flanking each opening.
    ctx.beginPath();
    for (const { x, half } of gates) {
      const ts = Math.max(4, w.width * 0.75, w.towerSize * 1.3), off = half + ts * 0.85;
      circle(ctx, G.add(x.p, G.scale(x.dirB, off)), ts);
      circle(ctx, G.sub(x.p, G.scale(x.dirB, off)), ts);
    }
    ctx.fillStyle = C.wall; ctx.fill();
  }

  const fam = (key) => S[key] || 'Cinzel';
  function drawSingle(f) {
    const sh = shape.get(f.id);
    switch (f.type) {
      case 'farm': drawFarm(f, sh); break;
      case 'water': if (sh.length >= 3) drawWater(ctx, f, sh, C, riverPolys()); break;
      case 'river': if (sh.length >= 2) drawRiver(ctx, f, sh, riverGeo(f), C, lakeShapes); break;
      case 'building': {
        if (sh.length < 3) break;
        // "District blocks" style gives a building the same fill, hatching and line weight as the blocks around it.
        const asBlock = f.style === 'district';
        ctx.beginPath(); addPath(ctx, sh, true);
        ctx.fillStyle = f.color || (asBlock ? toneColor(C, f.tone) : ({ solid: C.outline, light: C.street, block: C.block, accent: C.accent, water: C.water, park: C.park }[f.style] || C.outline));
        ctx.fill();
        if (asBlock && f.hatch && S.hatch && C.hatch) {
          const a = Math.max(0, Math.min(1, (k - 0.35) / 0.8));
          if (a > 0) { ctx.globalAlpha = a; ctx.fillStyle = hatchPattern(ctx, C.hatch, S.hatchSpacing); ctx.fill(); ctx.globalAlpha = 1; }
        }
        if (f.border !== false) { ctx.strokeStyle = C.outline; ctx.lineWidth = asBlock ? ow : ow * 1.3; ctx.stroke(); }
        break;
      }
      case 'cutout':
        if (sh.length < 3 || f.fill === 'none') break;
        ctx.beginPath(); addPath(ctx, sh, true);
        ctx.fillStyle = f.fill === 'park' ? C.park : C.street; ctx.fill();
        if (f.border !== false) { ctx.strokeStyle = C.outline; ctx.lineWidth = ow; ctx.stroke(); }
        break;
      case 'wall': if (sh.length >= (f.closed === false ? 2 : 3)) drawWall(f); break;
      case 'landmark': {
        const c = f.points[0];
        if (!c) break;
        ctx.beginPath(); circle(ctx, c, f.size);
        ctx.fillStyle = C.accent; ctx.fill();
        ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, f.size * 0.25); ctx.stroke();
        if (f.showLabel && f.name) {
          const p = G.add(c, f.labelOffset || [0, 0]);
          const poly = drawText(ctx, f.name, p[0], p[1], {
            size: f.labelSize, spacing: 0.06, family: fam('fontLabel'), upper: true, fill: C.label, halo: C.labelHalo, haloW: f.labelSize * haloOf(f),
          });
          if (poly) hits.push({ id: f.id, kind: 'offset', poly });
        }
        break;
      }
      case 'label': {
        const c = f.points[0];
        if (!c) break;
        const st = LABEL_STYLES[f.style] || LABEL_STYLES.district;
        // A street name attached to a road is set along the road's own curve.
        if (f.pathId && shape.has(f.pathId) && shape.get(f.pathId).length >= 2) {
          const pp = drawTextOnPath(ctx, shape.get(f.pathId), f.text, {
            pos: f.pathPos == null ? 0.5 : f.pathPos, size: f.size, spacing: f.spacing, family: fam(st.font),
            fill: f.color || C[st.fill], halo: st.halo ? C[st.halo] : null, haloW: f.size * haloOf(f),
          });
          if (pp) hits.push({ id: f.id, kind: 'pathpos', poly: pp });
          break;
        }
        const poly = drawText(ctx, f.text, c[0], c[1], {
          size: f.size, angle: f.angle, spacing: f.spacing, family: fam(st.font), upper: st.upper, italic: st.italic,
          fill: f.color || C[st.fill], halo: st.halo ? C[st.halo] : null, haloW: f.size * haloOf(f),
          boxed: st.boxed, boxFill: C.paper, boxStroke: C.frame,
        });
        if (poly) hits.push({ id: f.id, kind: 'move', poly });
        break;
      }
      case 'compass': if (f.points[0]) drawCompass(ctx, f, C, S); break;
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
      fill: water ? C.waterText : C.label, halo: water ? C.waterHalo : C.labelHalo, haloW: f.labelSize * haloOf(f),
    });
    if (poly) hits.push({ id: f.id, kind: 'offset', poly });
  }
  for (const f of feats) {
    if (f.type !== 'river' || !f.showLabel || !f.name) continue;
    const poly = drawTextOnPath(ctx, shape.get(f.id), f.name, {
      pos: f.labelPos, size: f.labelSize, spacing: f.labelSpacing, family: fam('fontLabel'), fill: C.waterText, halo: C.waterHalo, haloW: f.labelSize * haloOf(f), alpha: f.labelOpacity == null ? 0.7 : f.labelOpacity,
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
