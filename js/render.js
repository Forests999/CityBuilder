// Draws a map document onto a 2D canvas. Used for both the editor view and PNG export.

import * as G from './geom.js';
import { districtGen, fieldsGen } from './generate.js';
import { THEMES, FONT_WEIGHTS } from './themes.js';
import { makeNoise, hashStr } from './rng.js';

export function getColors(doc) {
  const t = THEMES[doc.settings.theme] || THEMES.ash;
  const c = { ...t.colors };
  for (const [k, v] of Object.entries(doc.settings.colors || {})) if (v) c[k] = v;
  return c;
}

const CLOSED = { wall: 1, district: 1, water: 1, building: 1 };
const POINT_TYPES = { plaza: 1, landmark: 1, label: 1, compass: 1 };
export const isClosed = (f) => !!CLOSED[f.type] || (f.type === 'road' && !!f.closed);
export const isPointType = (f) => !!POINT_TYPES[f.type];

export function findWalls(doc) {
  return doc.features.filter((f) => f.type === 'wall' && !f.hidden && f.points.length >= 3);
}

// The drawn outline of a feature (spline-smoothed or densified), in world units.
export function featureShape(f, doc) {
  if (f.type === 'district' && f.followWall) {
    const w = findWalls(doc)[0];
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
  ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
}

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
    if (pass === 'h') { ctx.strokeStyle = o.halo; ctx.lineWidth = o.haloW || size * 0.22; ctx.lineJoin = 'round'; }
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
  let path = pts, cum = G.cumLengths(path), L = cum[cum.length - 1], pos = o.pos;
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
    if (pass === 'h') { ctx.strokeStyle = o.halo; ctx.lineWidth = size * 0.22; ctx.lineJoin = 'round'; } else ctx.fillStyle = o.fill;
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

function toneColor(C, tone) {
  return tone === 'dark' ? C.blockDark : tone === 'light' ? C.blockLight : tone === 'park' ? C.park : C.block;
}

function drawDistrict(ctx, f, shape, C, S, k, center, wallClip) {
  const g = districtGen(f, shape, center);
  const base = f.color || toneColor(C, f.tone);
  const clipToWall = wallClip && f.clipWall && !f.followWall;
  ctx.save();
  if (clipToWall) wallClip();
  if (S.glow && C.glow) {
    ctx.save();
    ctx.shadowColor = C.glow; ctx.shadowBlur = S.glowSize * k;
    ctx.beginPath(); addPath(ctx, shape, true);
    ctx.strokeStyle = C.glow; ctx.lineWidth = S.glowSize * 0.5; ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath(); addPath(ctx, shape, true);
  ctx.clip();
  ctx.fillStyle = base; ctx.fill();
  if (f.hatch && S.hatch && C.hatch) {
    ctx.globalAlpha = Math.max(0, Math.min(1, (k - 0.35) / 0.8));
    if (ctx.globalAlpha > 0) { ctx.fillStyle = hatchPattern(ctx, C.hatch, S.hatchSpacing); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (g.lots.length) {
    ctx.beginPath();
    for (const l of g.lots) addPath(ctx, l, false);
    ctx.strokeStyle = C.outline; ctx.lineWidth = S.outline * 0.7; ctx.globalAlpha = 0.75; ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (g.opens.length) {
    ctx.beginPath();
    for (const p of g.opens) addPath(ctx, p, true);
    ctx.fillStyle = C.street; ctx.fill();
    ctx.strokeStyle = C.outline; ctx.lineWidth = S.outline * 0.8; ctx.stroke();
  }
  for (const pass of [0, 1]) {
    for (const [w, lines] of g.buckets) {
      ctx.beginPath();
      for (const l of lines) addPath(ctx, l, false);
      ctx.strokeStyle = pass ? C.street : C.outline;
      ctx.lineWidth = pass ? w : w + S.outline * 2;
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.save();
  if (clipToWall) wallClip();
  ctx.beginPath(); addPath(ctx, shape, true);
  if (f.borderStreet > 0) {
    ctx.strokeStyle = C.outline; ctx.lineWidth = f.borderStreet + S.outline * 2; ctx.stroke();
    ctx.strokeStyle = C.street; ctx.lineWidth = f.borderStreet; ctx.stroke();
  } else {
    ctx.strokeStyle = C.outline; ctx.lineWidth = S.outline; ctx.stroke();
  }
  ctx.restore();
}

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

function riverBanks(f, sh) {
  const nrm = G.pathNormals(sh, false), cum = G.cumLengths(sh);
  const nz = makeNoise(hashStr(f.id));
  const wob = f.canal ? 0 : +f.wobble || 0;
  const w = sh.map((_, i) => (f.width / 2) * Math.max(0.3, 1 + wob * nz(cum[i] / (f.width * 2.5), 0.5) * 1.4));
  const L = sh.map((p, i) => [p[0] + nrm[i][0] * w[i], p[1] + nrm[i][1] * w[i]]);
  const R = sh.map((p, i) => [p[0] - nrm[i][0] * w[i], p[1] - nrm[i][1] * w[i]]);
  return { L, R, w, nrm, cum };
}

function drawRiver(ctx, f, sh, C) {
  if (sh.length < 2) return;
  const { L, R, w, nrm, cum } = riverBanks(f, sh);
  const poly = L.concat(R.slice().reverse());
  ctx.save();
  ctx.beginPath(); addPath(ctx, poly, true);
  ctx.fillStyle = C.water; ctx.fill();
  ctx.clip();
  ctx.strokeStyle = C.waterLine; ctx.lineWidth = 1;
  if (f.canal) {
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); addPath(ctx, sh, false); ctx.stroke();
  } else {
    const cnt = Math.max(2, Math.round(f.width / 8));
    for (let j = 0; j < cnt; j++) {
      const fr = -0.8 + (1.6 * (j + 0.5)) / cnt;
      ctx.beginPath();
      for (let i = 0; i < sh.length; i++) {
        const off = fr * w[i] + Math.sin(cum[i] * 0.06 + j * 2.1) * 1.6;
        const x = sh[i][0] + nrm[i][0] * off, y = sh[i][1] + nrm[i][1] * off;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.setLineDash([14 + ((j * 7) % 17), 5 + ((j * 5) % 9)]);
      ctx.lineDashOffset = j * 11;
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
  ctx.beginPath(); addPath(ctx, L, false); addPath(ctx, R, false);
  ctx.strokeStyle = C.waterEdge; ctx.lineWidth = f.canal ? 2.4 : 2; ctx.stroke();
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
  ctx.strokeStyle = C.frame; ctx.lineWidth = Math.max(1.5, fw * 0.06);
  ctx.strokeRect(fw + fw * 0.2, fw + fw * 0.2, W - 2 * fw - fw * 0.4, H - 2 * fw - fw * 0.4);
}

export const LABEL_STYLES = {
  district: { name: 'District (large, spaced)', font: 'fontLabel', fill: 'label', halo: 'labelHalo', upper: true },
  place: { name: 'Place (small caps)', font: 'fontLabel', fill: 'label', halo: 'labelHalo', upper: true },
  gate: { name: 'Outside / gate (accent)', font: 'fontLabel', fill: 'accent', halo: 'paper', upper: true },
  water: { name: 'Water', font: 'fontLabel', fill: 'waterText', halo: 'waterHalo', upper: true },
  ink: { name: 'Plain ink', font: 'fontLabel', fill: 'outline', halo: null, upper: false },
  script: { name: 'Script (italic)', font: 'fontScript', fill: 'outline', halo: 'paper', upper: false, italic: true },
  title: { name: 'Title box', font: 'fontTitle', fill: 'accent', halo: null, upper: true, boxed: true },
};

// o: { s, ox, oy, dpr, hits?: [], ref?: {img, opacity} }
export function renderMap(ctx, doc, o) {
  const C = getColors(doc), S = doc.settings, W = doc.meta.width, H = doc.meta.height;
  const k = o.s * o.dpr;
  ctx.setTransform(k, 0, 0, k, o.ox * o.dpr, o.oy * o.dpr);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hits = o.hits || [];
  const feats = doc.features.filter((f) => !f.hidden);
  const shape = new Map();
  for (const f of feats) shape.set(f.id, featureShape(f, doc));
  const by = (t) => feats.filter((f) => f.type === t);
  const walls = by('wall').filter((f) => shape.get(f.id).length >= 3);
  const wallClip = walls.length ? () => {
    ctx.beginPath();
    for (const w of walls) addPath(ctx, shape.get(w.id), true);
    ctx.clip();
  } : null;
  const center = walls.length ? G.centroid(shape.get(walls[0].id)) : [W / 2, H / 2];

  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

  if (S.fields) {
    ctx.beginPath();
    for (const l of fieldsGen(W, H, S.fieldSize, S.seed)) addPath(ctx, l, false);
    ctx.strokeStyle = C.field; ctx.lineWidth = 1.1; ctx.stroke();
  }

  const roads = by('road');
  ctx.strokeStyle = C.ruralRoad;
  for (const r of roads) {
    const rural = r.kind === 'rural';
    if (!rural && !(r.ruralOutside && walls.length)) continue;
    const sh = shape.get(r.id);
    if (sh.length < 2) continue;
    ctx.beginPath(); addPath(ctx, sh, r.closed);
    ctx.lineWidth = rural ? Math.max(1.2, r.width * 0.25) : Math.max(1.4, r.width * 0.16);
    ctx.stroke();
  }

  for (const f of by('water')) { const sh = shape.get(f.id); if (sh.length >= 3) drawWater(ctx, f, sh, C); }
  for (const f of by('district')) {
    const sh = shape.get(f.id);
    if (sh.length >= 3) drawDistrict(ctx, f, sh, C, S, k, center, wallClip);
  }
  for (const f of by('river')) drawRiver(ctx, f, shape.get(f.id), C);

  const cityRoads = roads.filter((r) => r.kind !== 'rural' && shape.get(r.id).length >= 2);
  const plazas = by('plaza').filter((p) => p.points.length);
  for (const pass of [0, 1]) {
    const color = pass ? C.street : C.outline, extra = pass ? 0 : S.outline * 2;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    for (const r of cityRoads) {
      const clip = r.ruralOutside && wallClip;
      if (clip) { ctx.save(); wallClip(); }
      ctx.beginPath(); addPath(ctx, shape.get(r.id), r.closed);
      ctx.lineWidth = r.width + extra; ctx.stroke();
      if (clip) ctx.restore();
    }
    ctx.beginPath();
    for (const p of plazas) circle(ctx, p.points[0], p.radius + extra / 2);
    ctx.fill();
  }
  for (const p of plazas) drawMonument(ctx, p, C, S);

  for (const b of by('building')) {
    const sh = shape.get(b.id);
    if (sh.length < 3) continue;
    ctx.beginPath(); addPath(ctx, sh, true);
    ctx.fillStyle = { solid: C.outline, light: C.street, block: C.block, accent: C.accent, water: C.water, park: C.park }[b.style] || C.outline;
    ctx.fill();
    ctx.strokeStyle = C.outline; ctx.lineWidth = S.outline * 1.3; ctx.stroke();
  }

  for (const w of walls) {
    const sh = shape.get(w.id);
    ctx.beginPath(); addPath(ctx, sh, true);
    ctx.strokeStyle = C.wall; ctx.lineWidth = w.width; ctx.stroke();
    ctx.fillStyle = C.wall;
    if (w.towerSize > 0) {
      const ring = sh.concat([sh[0]]), cum = G.cumLengths(ring), L = cum[cum.length - 1];
      const step = Math.max(10, w.towerSpacing);
      ctx.beginPath();
      for (let s = 0; s < L - step * 0.5; s += step) circle(ctx, G.pointAt(ring, cum, s).p, w.towerSize);
      if (!w.smooth) for (const v of w.points) circle(ctx, v, w.towerSize * 1.4);
      ctx.fill();
    }
    if (!w.gates) continue;
    for (const r of cityRoads) {
      if (!r.gates) continue;
      for (const x of G.pathIntersections(shape.get(r.id), r.closed, sh, true)) {
        const L = w.width + w.towerSize * 2 + 4;
        const a = G.sub(x.p, G.scale(x.dirA, L)), b = G.add(x.p, G.scale(x.dirA, L));
        ctx.lineCap = 'butt';
        for (const pass of [0, 1]) {
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          ctx.strokeStyle = pass ? C.street : C.outline;
          ctx.lineWidth = pass ? r.width : r.width + S.outline * 2;
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

  // Labels and markers
  const fam = (key) => S[key] || 'Cinzel';
  for (const f of [...by('water'), ...by('district')]) {
    if (!f.showLabel || !f.name) continue;
    const sh = shape.get(f.id);
    if (sh.length < 3) continue;
    const c = G.add(G.centroid(sh), f.labelOffset || [0, 0]);
    const water = f.type === 'water';
    const poly = drawText(ctx, f.name, c[0], c[1], {
      size: f.labelSize, angle: f.labelAngle, spacing: f.labelSpacing, family: fam('fontLabel'), upper: true,
      fill: water ? C.waterText : C.label, halo: water ? C.waterHalo : C.labelHalo,
    });
    if (poly) hits.push({ id: f.id, kind: 'offset', poly });
  }
  for (const f of by('river')) {
    if (!f.showLabel || !f.name) continue;
    const poly = drawTextOnPath(ctx, shape.get(f.id), f.name, {
      pos: f.labelPos, size: f.labelSize, spacing: f.labelSpacing, family: fam('fontLabel'), fill: C.waterText, halo: C.waterHalo,
    });
    if (poly) hits.push({ id: f.id, kind: 'pathpos', poly });
  }
  for (const m of by('landmark')) {
    const c = m.points[0];
    if (!c) continue;
    ctx.beginPath(); circle(ctx, c, m.size);
    ctx.fillStyle = C.accent; ctx.fill();
    ctx.strokeStyle = C.outline; ctx.lineWidth = Math.max(1, m.size * 0.25); ctx.stroke();
    if (m.showLabel && m.name) {
      const p = G.add(c, m.labelOffset || [0, 0]);
      const poly = drawText(ctx, m.name, p[0], p[1], {
        size: m.labelSize, spacing: 0.06, family: fam('fontLabel'), upper: true, fill: C.label, halo: C.labelHalo,
      });
      if (poly) hits.push({ id: m.id, kind: 'offset', poly });
    }
  }
  for (const l of by('label')) {
    const c = l.points[0];
    if (!c) continue;
    const st = LABEL_STYLES[l.style] || LABEL_STYLES.district;
    const poly = drawText(ctx, l.text, c[0], c[1], {
      size: l.size, angle: l.angle, spacing: l.spacing, family: fam(st.font), upper: st.upper, italic: st.italic,
      fill: l.color || C[st.fill], halo: st.halo ? C[st.halo] : null, boxed: st.boxed, boxFill: C.paper, boxStroke: C.frame,
    });
    if (poly) hits.push({ id: l.id, kind: 'move', poly });
  }
  for (const c of by('compass')) if (c.points[0]) drawCompass(ctx, c.points[0], c.size, C, S);

  if (o.ref && o.ref.img && o.ref.visible) {
    ctx.globalAlpha = o.ref.opacity;
    const r = o.ref, iw = r.img.width * r.scale, ih = r.img.height * r.scale;
    ctx.drawImage(r.img, r.x, r.y, iw, ih);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (S.frame) drawFrame(ctx, W, H, C, S);
}
