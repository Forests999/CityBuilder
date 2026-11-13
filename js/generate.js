// Procedural street networks. A district's area is recursively cut by lines
// (each cut becomes a street), then the result is gently warped with noise
// so the streets curve organically instead of looking ruled.

import { polyArea, centroid, bbox, pointInPoly, splitConvex, extentAlong, fromAngle, perp, norm, sub, dist, lerp, rotate, densify } from './geom.js';
import { makeRng, makeNoise } from './rng.js';

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

const cache = new Map();
function remember(key, make) {
  if (cache.has(key)) return cache.get(key);
  const v = make();
  if (cache.size > 400) cache.clear();
  cache.set(key, v);
  return v;
}

export function districtGen(f, shape, center) {
  const key = ['d', f.pattern, f.blockSize, f.streetWidth, f.irregularity, f.warp, f.gridAngle, f.lots, f.courtyards, f.seed,
    f.pattern === 'radial' ? center.map(Math.round).join(',') : '',
    shape.map((p) => Math.round(p[0]) + ',' + Math.round(p[1])).join(';')].join('|');
  return remember(key, () => subdivide(shape, {
    pattern: f.pattern, blockSize: Math.max(6, +f.blockSize || 38), streetWidth: +f.streetWidth || 4,
    irregularity: +f.irregularity || 0, warp: +f.warp || 0, gridAngle: +f.gridAngle || 0,
    lots: !!f.lots, courtyards: +f.courtyards || 0, seed: (f.seed >>> 0) || 1, center,
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

function subdivide(shape, o) {
  const rng = makeRng(o.seed);
  const noise = makeNoise((o.seed ^ 0x5bd1e995) >>> 0);
  const sb = bbox(shape), bs = o.blockSize, pad = bs * 0.5;
  const root = [[sb.x0 - pad, sb.y0 - pad], [sb.x1 + pad, sb.y0 - pad], [sb.x1 + pad, sb.y1 + pad], [sb.x0 - pad, sb.y1 + pad]];
  const target = bs * bs, irr = o.irregularity, ga = (o.gridAngle * Math.PI) / 180;
  const chords = [], lotChords = [], opens = [];
  const MAX = 30000;
  let count = 0;
  const stack = [[root, 0, false]];

  function chooseNormal(poly, c) {
    if (o.pattern === 'grid' || o.pattern === 'radial') {
      let a;
      if (o.pattern === 'grid') a = fromAngle(ga);
      else { const d = sub(c, o.center); a = Math.hypot(d[0], d[1]) < 1e-3 ? [1, 0] : norm(d); }
      const b = perp(a);
      const ea = extentAlong(poly, a), eb = extentAlong(poly, b);
      const n = ea[1] - ea[0] >= eb[1] - eb[0] ? a : b;
      return rotate(n, (rng.next() - 0.5) * irr * (o.pattern === 'grid' ? 0.25 : 0.5));
    }
    let best = 0, bn = [1, 0];
    for (let k = 0; k < 12; k++) {
      const v = fromAngle((k * Math.PI) / 12);
      const e = extentAlong(poly, v);
      if (e[1] - e[0] > best) { best = e[1] - e[0]; bn = v; }
    }
    return rotate(bn, (rng.next() - 0.5) * irr * 0.5);
  }

  function cut(poly, n, spread) {
    const c = centroid(poly);
    const [mn, mx] = extentAlong(poly, n);
    const t = 0.5 + (rng.next() - 0.5) * spread;
    const off = mn + (mx - mn) * t - (c[0] * n[0] + c[1] * n[1]);
    return splitConvex(poly, [c[0] + n[0] * off, c[1] + n[1] * off], n);
  }

  function lotSplit(poly, d) {
    const area = Math.abs(polyArea(poly));
    const la = (bs * 0.42) ** 2;
    if (area < la * (0.6 + rng.next() * 0.8) || d > 5) {
      if (rng.next() < o.courtyards) opens.push(poly);
      return;
    }
    let best = 0, bn = [1, 0];
    for (let k = 0; k < 8; k++) {
      const v = fromAngle((k * Math.PI) / 8);
      const e = extentAlong(poly, v);
      if (e[1] - e[0] > best) { best = e[1] - e[0]; bn = v; }
    }
    const r = cut(poly, bn, 0.3);
    if (!r) return;
    lotChords.push([r[2], r[3]]);
    lotSplit(r[0], d + 1); lotSplit(r[1], d + 1);
  }

  function leaf(poly) {
    if (o.lots) lotSplit(poly, 0);
    else if (o.courtyards > 0 && rng.next() < o.courtyards * 0.4) opens.push(poly);
  }

  while (stack.length) {
    const [poly, depth, full] = stack.pop();
    let state = 2;
    if (!full) { state = overlapState(poly, shape, sb); if (state === 0) continue; }
    const area = Math.abs(polyArea(poly));
    if (area < target * (0.6 + rng.next() * 0.9) || depth > 26 || count > MAX) { count++; leaf(poly); continue; }
    const c = centroid(poly);
    const r = cut(poly, chooseNormal(poly, c), 0.1 + irr * 0.6);
    if (!r) { count++; leaf(poly); continue; }
    chords.push([r[2], r[3]]);
    stack.push([r[0], depth + 1, state === 2], [r[1], depth + 1, state === 2]);
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
    const L = dist(a, b);
    const k = L > bs * 7 ? 1.9 : L > bs * 3.5 ? 1.35 : L < bs * 0.9 ? 0.75 : 1;
    const w = Math.round(o.streetWidth * k * 10) / 10;
    if (!buckets.has(w)) buckets.set(w, []);
    buckets.get(w).push(line(a, b));
  }
  return {
    buckets: [...buckets.entries()].sort((a, b) => b[0] - a[0]),
    lots: lotChords.map(([a, b]) => line(a, b)),
    opens: opens.map((p) => densify(p, true, 7).map(W)),
  };
}
