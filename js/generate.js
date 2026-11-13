// Procedural street networks.
//
// Every district carves its streets out of ONE city-wide subdivision: a huge
// root square is recursively cut by lines (each cut becomes a street), and a
// district only keeps the cuts that fall inside it. Each cut's randomness is
// derived from its position in that tree rather than from a running random
// stream, so two districts with the same seed and settings produce identical
// streets wherever they meet. Splitting a district therefore leaves no seam.

import { polyArea, centroid, bbox, pointInPoly, splitConvex, extentAlong, fromAngle, perp, norm, sub, dist, lerp, rotate, densify } from './geom.js';
import { mulberry32, makeNoise } from './rng.js';

export const PRESETS = {
  standard:   { pattern: 'organic', blockSize: 38, streetWidth: 4,   irregularity: 0.6,  warp: 10, lots: false, courtyards: 0,    tone: 'normal', hatch: true },
  dense:      { pattern: 'organic', blockSize: 20, streetWidth: 2.6, irregularity: 0.9,  warp: 7,  lots: false, courtyards: 0,    tone: 'dark',   hatch: true },
  noble:      { pattern: 'radial',  blockSize: 70, streetWidth: 5.5, irregularity: 0.3,  warp: 5,  lots: false, courtyards: 0.25, tone: 'light',  hatch: true },
  radial:     { pattern: 'radial',  blockSize: 40, streetWidth: 4,   irregularity: 0.45, warp: 6,  lots: false, courtyards: 0,    tone: 'normal', hatch: true },
  grid:       { pattern: 'grid',    blockSize: 45, streetWidth: 4,   irregularity: 0.15, warp: 2,  lots: false, courtyards: 0,    tone: 'normal', hatch: true },
  townhouses: { pattern: 'organic', blockSize: 60, streetWidth: 4.5, irregularity: 0.5,  warp: 3,  lots: true,  courtyards: 0.12, tone: 'normal', hatch: false },
  industrial: { pattern: 'grid',    blockSize: 85, streetWidth: 5,   irregularity: 0.25, warp: 1,  lots: true,  courtyards: 0.05, tone: 'dark',   hatch: true },
  park:       { pattern: 'organic', blockSize: 400, streetWidth: 3,  irregularity: 0.5,  warp: 4,  lots: false, courtyards: 0,    tone: 'park',   hatch: false },
};

export const PRESET_LABELS = {
  standard: 'Standard quarter', dense: 'Dense slums', noble: 'Noble estates', radial: 'Radial rings',
  grid: 'Planned grid', townhouses: 'Townhouses & lots', industrial: 'Docks / industry', park: 'Park / gardens',
};

const ROOT = [[-8000, -8000], [18000, -8000], [18000, 18000], [-8000, 18000]];

const cache = new Map();
function remember(key, make) {
  if (cache.has(key)) return cache.get(key);
  const v = make();
  if (cache.size > 400) cache.clear();
  cache.set(key, v);
  return v;
}
const shapeKey = (shape) => shape.map((p) => Math.round(p[0]) + ',' + Math.round(p[1])).join(';');

export function districtGen(f, shape, center) {
  const key = ['d', f.pattern, f.blockSize, f.streetWidth, f.irregularity, f.warp, f.gridAngle, f.lots, f.courtyards, f.seed,
    f.pattern === 'radial' ? center.map(Math.round).join(',') : '', shapeKey(shape)].join('|');
  return remember(key, () => subdivide(shape, {
    pattern: f.pattern, blockSize: Math.max(6, +f.blockSize || 38), streetWidth: +f.streetWidth || 4,
    irregularity: +f.irregularity || 0, warp: +f.warp || 0, gridAngle: +f.gridAngle || 0,
    lots: !!f.lots, courtyards: +f.courtyards || 0, seed: (f.seed >>> 0) || 1, center,
  }));
}

export function farmGen(f, shape, center) {
  const key = ['farm', f.pattern, f.parcelSize, f.irregularity, f.warp, f.gridAngle, f.seed, shapeKey(shape)].join('|');
  return remember(key, () => subdivide(shape, {
    pattern: f.pattern, blockSize: Math.max(15, +f.parcelSize || 110), streetWidth: 1,
    irregularity: +f.irregularity || 0, warp: +f.warp || 0, gridAngle: +f.gridAngle || 0,
    lots: false, courtyards: 0, seed: ((f.seed >>> 0) || 1) ^ 0x51ed27, center, leaves: true,
  }));
}

export function fieldsGen(W, H, size, seed) {
  return remember(['f', W, H, size, seed].join('|'), () => {
    const rect = densify([[0, 0], [W, 0], [W, H], [0, H]], true, Math.max(20, size / 3));
    const g = subdivide(rect, { pattern: 'organic', blockSize: Math.max(40, size), streetWidth: 1, irregularity: 0.9,
      warp: size * 0.12, gridAngle: 0, lots: false, courtyards: 0, seed: ((seed >>> 0) || 1) + 991, center: [W / 2, H / 2] });
    const lines = [];
    for (const [, ls] of g.buckets) lines.push(...ls);
    return lines;
  });
}

function h32(a, b) {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2d, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// 0 = no overlap, 1 = partial, 2 = poly fully inside shape.
function overlapState(poly, shape, sb) {
  const pb = bbox(poly);
  if (pb.x1 < sb.x0 || pb.x0 > sb.x1 || pb.y1 < sb.y0 || pb.y0 > sb.y1) return 0;
  let inside = 0;
  for (const v of poly) if (pointInPoly(v, shape)) inside++;
  let shapeIn = false;
  for (const s of shape) {
    if (s[0] < pb.x0 || s[0] > pb.x1 || s[1] < pb.y0 || s[1] > pb.y1) continue;
    if (pointInPoly(s, poly)) { shapeIn = true; break; }
  }
  if (inside === poly.length && !shapeIn) return 2;
  if (inside > 0 || shapeIn) return 1;
  return 0;
}

function longestAxisNormal(poly, steps) {
  let best = 0, bn = [1, 0];
  for (let k = 0; k < steps; k++) {
    const v = fromAngle((k * Math.PI) / steps);
    const e = extentAlong(poly, v);
    if (e[1] - e[0] > best) { best = e[1] - e[0]; bn = v; }
  }
  return bn;
}

function subdivide(shape, o) {
  const noise = makeNoise((o.seed ^ 0x5bd1e995) >>> 0);
  const sb = bbox(shape), bs = o.blockSize;
  const target = bs * bs, irr = o.irregularity, ga = (o.gridAngle * Math.PI) / 180;
  const chords = [], lotChords = [], opens = [], leaves = [];
  const MAX = 30000;
  let count = 0;
  const stack = [[ROOT, 0, false, o.seed >>> 0]];

  function chooseNormal(poly, c, rnd) {
    if (o.pattern === 'grid' || o.pattern === 'radial') {
      let a;
      if (o.pattern === 'grid') a = fromAngle(ga);
      else { const d = sub(c, o.center); a = Math.hypot(d[0], d[1]) < 1e-3 ? [1, 0] : norm(d); }
      const b = perp(a);
      const ea = extentAlong(poly, a), eb = extentAlong(poly, b);
      const n = ea[1] - ea[0] >= eb[1] - eb[0] ? a : b;
      return rotate(n, (rnd() - 0.5) * irr * (o.pattern === 'grid' ? 0.25 : 0.5));
    }
    return rotate(longestAxisNormal(poly, 12), (rnd() - 0.5) * irr * 0.5);
  }

  // Cut straight across the longest edge, near its middle: gives squarish,
  // T-junctioned blocks instead of slivers.
  function edgeCut(poly, spread, jitter, rnd) {
    const m = poly.length;
    let bi = 0, bl = 0;
    for (let i = 0; i < m; i++) { const L = dist(poly[i], poly[(i + 1) % m]); if (L > bl) { bl = L; bi = i; } }
    const a = poly[bi], b = poly[(bi + 1) % m];
    const n = rotate(norm(sub(b, a)), (rnd() - 0.5) * jitter);
    return splitConvex(poly, lerp(a, b, 0.5 + (rnd() - 0.5) * spread), n);
  }

  function cut(poly, n, spread, rnd) {
    const c = centroid(poly);
    const [mn, mx] = extentAlong(poly, n);
    const t = 0.5 + (rnd() - 0.5) * spread;
    const off = mn + (mx - mn) * t - (c[0] * n[0] + c[1] * n[1]);
    return splitConvex(poly, [c[0] + n[0] * off, c[1] + n[1] * off], n);
  }

  function lotSplit(poly, d, hash) {
    const rnd = mulberry32(hash);
    const area = Math.abs(polyArea(poly));
    const la = (bs * 0.42) ** 2;
    if (area < la * (0.6 + rnd() * 0.8) || d > 5) {
      if (rnd() < o.courtyards) opens.push(poly);
      return;
    }
    const r = edgeCut(poly, 0.3, 0.1, rnd);
    if (!r) return;
    lotChords.push([r[2], r[3]]);
    lotSplit(r[0], d + 1, h32(hash, 11)); lotSplit(r[1], d + 1, h32(hash, 12));
  }

  function leaf(poly, hash) {
    if (o.leaves) leaves.push(poly);
    if (o.lots) lotSplit(poly, 0, h32(hash, 7));
    else if (o.courtyards > 0 && mulberry32(h32(hash, 9))() < o.courtyards * 0.4) opens.push(poly);
  }

  while (stack.length) {
    const [poly, depth, full, hash] = stack.pop();
    let state = 2;
    if (!full) { state = overlapState(poly, shape, sb); if (state === 0) continue; }
    const rnd = mulberry32(hash);
    const area = Math.abs(polyArea(poly));
    if (area < target * (0.6 + rnd() * 0.9) || depth > 60 || count > MAX) { count++; leaf(poly, hash); continue; }
    const r = o.pattern === 'organic'
      ? edgeCut(poly, 0.1 + irr * 0.5, irr * 0.6, rnd)
      : cut(poly, chooseNormal(poly, centroid(poly), rnd), 0.1 + irr * 0.6, rnd);
    if (!r) { count++; leaf(poly, hash); continue; }
    chords.push([r[2], r[3]]);
    stack.push([r[0], depth + 1, state === 2, h32(hash, 1)], [r[1], depth + 1, state === 2, h32(hash, 2)]);
  }

  const fq = 1 / (bs * 3.5), A = o.warp;
  const W = (p) => (A ? [p[0] + noise(p[0] * fq, p[1] * fq) * A, p[1] + noise(p[0] * fq + 37.2, p[1] * fq - 11.9) * A] : p);
  const line = (a, b) => {
    const m = Math.max(1, Math.ceil(dist(a, b) / 7));
    const out = [];
    for (let i = 0; i <= m; i++) out.push(W(lerp(a, b, i / m)));
    return out;
  };

  const buckets = new Map();
  for (const [a, b] of chords) {
    // Only keep the part of huge ancestor cuts that is near the shape.
    let p = a, q = b;
    const L0 = dist(a, b);
    if (L0 > 4 * Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0)) {
      const clipped = clipSegToBox(a, b, sb.x0 - bs, sb.y0 - bs, sb.x1 + bs, sb.y1 + bs);
      if (!clipped) continue;
      [p, q] = clipped;
    }
    const k = L0 > bs * 7 ? 1.9 : L0 > bs * 3.5 ? 1.35 : L0 < bs * 0.9 ? 0.75 : 1;
    const w = Math.round(o.streetWidth * k * 10) / 10;
    if (!buckets.has(w)) buckets.set(w, []);
    buckets.get(w).push(line(p, q));
  }
  return {
    buckets: [...buckets.entries()].sort((a, b) => b[0] - a[0]),
    lots: lotChords.map(([a, b]) => line(a, b)),
    opens: opens.map((p) => densify(p, true, 7).map(W)),
    leaves: leaves.map((p) => densify(p, true, 9).map(W)),
  };
}

// Liang-Barsky segment clipping.
function clipSegToBox(a, b, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const tests = [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [lerp(a, b, t0), lerp(a, b, t1)];
}
