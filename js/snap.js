// Snapping and alignment. Everything here can be switched off from the Snap menu, and
// holding Alt bypasses it for a single action.

import * as G from './geom.js';
import { isClosed } from './render.js';

const KEY = 'citybuilder.snap';

export const snap = {
  enabled: true,   // master switch
  points: true,    // snap to other features' corner points
  edges: true,     // snap onto the outline of other features
  guides: true,    // line up with other points horizontally / vertically
  grid: false,     // snap to a grid
  gridSize: 25,
  showGrid: false,
  angle: true,     // hold Shift while drawing to lock to 15° steps
};

export function loadSnap() {
  try { Object.assign(snap, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* ignore */ }
}
export function saveSnap() {
  try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch (e) { /* ignore */ }
}

// Control points of a feature (a wall-following district uses its wall's points).
function pointsOf(f, feats) {
  if (f.type === 'district' && f.followWall) {
    const w = feats.find((x) => x.id === f.followWall);
    return w ? w.points : [];
  }
  return f.points || [];
}

function collect(feats, skip, forVertex) {
  const out = [];
  for (const f of feats) {
    if (skip.has(f.id) || f.hidden) continue;
    if (f.type === 'label') continue;
    if (forVertex && (f.type === 'compass' || f.type === 'landmark')) continue;
    for (const p of pointsOf(f, feats)) out.push(p);
    if (out.length > 6000) break;
  }
  return out;
}

// Snap a single point (drawing a new point, dragging a vertex, placing something).
// o: { feats, tol, skip:Set, from, shift, disabled }
export function snapPoint(w, o) {
  const res = { p: w, marker: null, gx: null, gy: null };
  if (o.disabled || !snap.enabled) return res;
  let p = w;
  const tol = o.tol;
  if (o.shift && o.from && snap.angle) {
    const v = G.sub(w, o.from), len = Math.hypot(v[0], v[1]), step = Math.PI / 12;
    const a = Math.round(Math.atan2(v[1], v[0]) / step) * step;
    p = G.add(o.from, [Math.cos(a) * len, Math.sin(a) * len]);
    res.p = p;
  }
  const skip = o.skip || new Set();
  if (snap.points) {
    let best = null, bd = tol;
    for (const q of collect(o.feats, skip, true)) { const d = G.dist(q, p); if (d < bd) { bd = d; best = q; } }
    if (best) { res.p = best.slice(); res.marker = best.slice(); return res; }
  }
  if (snap.edges) {
    let best = null, bd = tol * 0.8;
    for (const f of o.feats) {
      if (skip.has(f.id) || f.hidden || f.type === 'label' || f.type === 'compass' || f.type === 'landmark' || f.type === 'plaza') continue;
      const pts = pointsOf(f, o.feats);
      if (pts.length < 2) continue;
      const r = G.nearestOnPath(p, pts, isClosed(f));
      if (r.d < bd) { bd = r.d; best = r.q; }
    }
    if (best) { res.p = best.slice(); res.marker = best.slice(); return res; }
  }
  let x = p[0], y = p[1];
  if (snap.guides) {
    let bx = tol, by = tol;
    for (const q of collect(o.feats, skip, false)) {
      const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
      if (dx < bx) { bx = dx; x = q[0]; res.gx = q[0]; }
      if (dy < by) { by = dy; y = q[1]; res.gy = q[1]; }
    }
  }
  if (snap.grid && snap.gridSize > 0) {
    const gs = snap.gridSize;
    if (res.gx == null) x = Math.round(x / gs) * gs;
    if (res.gy == null) y = Math.round(y / gs) * gs;
  }
  res.p = [x, y];
  return res;
}

// Snap the movement of a set of points (dragging features). movers: points being moved
// (in their original positions); targets: points of everything else.
export function snapMove(delta, movers, feats, skip, tol) {
  const res = { d: delta, marker: null, gx: null, gy: null };
  if (!snap.enabled || !movers.length) return res;
  const ms = movers.length > 80 ? movers.filter((_, i) => i % Math.ceil(movers.length / 80) === 0) : movers;
  const targets = collect(feats, skip, false);
  let dx = delta[0], dy = delta[1];
  if (snap.points) {
    let best = null, bd = tol;
    for (const m of ms) {
      const mx = m[0] + delta[0], my = m[1] + delta[1];
      for (const t of targets) {
        const d = Math.hypot(t[0] - mx, t[1] - my);
        if (d < bd) { bd = d; best = [t[0] - m[0], t[1] - m[1], t]; }
      }
    }
    if (best) { res.d = [best[0], best[1]]; res.marker = best[2].slice(); return res; }
  }
  if (snap.guides) {
    let bx = tol, by = tol;
    for (const m of ms) {
      const mx = m[0] + delta[0], my = m[1] + delta[1];
      for (const t of targets) {
        const ex = Math.abs(t[0] - mx), ey = Math.abs(t[1] - my);
        if (ex < bx) { bx = ex; dx = t[0] - m[0]; res.gx = t[0]; }
        if (ey < by) { by = ey; dy = t[1] - m[1]; res.gy = t[1]; }
      }
    }
  }
  if (snap.grid && snap.gridSize > 0) {
    const gs = snap.gridSize, m = ms[0];
    if (res.gx == null) dx = Math.round((m[0] + dx) / gs) * gs - m[0];
    if (res.gy == null) dy = Math.round((m[1] + dy) / gs) * gs - m[1];
  }
  res.d = [dx, dy];
  return res;
}
