// Procedural street networks.
//
// Every district carves its streets out of ONE city-wide subdivision: a huge
// root square is recursively cut by lines (each cut becomes a street), and a
// district only keeps the cuts that fall inside it. Each cut's randomness is
// derived from its position in that tree rather than from a running random
// stream, so two districts with the same seed and settings produce identical
// streets wherever they meet. Splitting a district therefore leaves no seam.

import { polyArea, centroid, bbox, pointInPoly, splitConvex, extentAlong, fromAngle, perp, norm, sub, dist, lerp, rotate, densify, inflatePoly, projSeg } from './geom.js';
import { mulberry32, makeNoise } from './rng.js';

export const PRESETS = {
  standard:   { pattern: 'organic', blockSize: 38, streetWidth: 4,   irregularity: 0.6,  warp: 10, lots: false, courtyards: 0,    tone: 'normal', hatch: true, look: 'blocks' },
  dense:      { pattern: 'organic', blockSize: 20, streetWidth: 2.6, irregularity: 0.9,  warp: 7,  lots: false, courtyards: 0,    tone: 'dark',   hatch: true, look: 'blocks' },
  noble:      { pattern: 'radial',  blockSize: 70, streetWidth: 5.5, irregularity: 0.3,  warp: 5,  lots: false, courtyards: 0.25, tone: 'light',  hatch: true, look: 'blocks' },
  radial:     { pattern: 'radial',  blockSize: 40, streetWidth: 4,   irregularity: 0.45, warp: 6,  lots: false, courtyards: 0,    tone: 'normal', hatch: true, look: 'blocks' },
  grid:       { pattern: 'grid',    blockSize: 45, streetWidth: 4,   irregularity: 0.15, warp: 2,  lots: false, courtyards: 0,    tone: 'normal', hatch: true, look: 'blocks' },
  townhouses: { pattern: 'organic', blockSize: 60, streetWidth: 4.5, irregularity: 0.5,  warp: 3,  lots: true,  courtyards: 0.12, tone: 'normal', hatch: false, look: 'blocks' },
  industrial: { pattern: 'grid',    blockSize: 85, streetWidth: 5,   irregularity: 0.25, warp: 1,  lots: true,  courtyards: 0.05, tone: 'dark',   hatch: true, look: 'blocks' },
  market:     { pattern: 'grid',    blockSize: 26, streetWidth: 2.4, irregularity: 0.2,  warp: 1.5, lots: true,  courtyards: 0.2,  tone: 'light',  hatch: false, look: 'blocks' },
  cemetery:   { pattern: 'grid',    blockSize: 80, streetWidth: 2.2, irregularity: 0.1,  warp: 2,  lots: false, courtyards: 0,    tone: 'park',   hatch: false, look: 'cemetery', graveSpacing: 8 },
  park:       { pattern: 'organic', blockSize: 110, streetWidth: 2.2, irregularity: 0.6, warp: 14, lots: false, courtyards: 0,    tone: 'park',   hatch: false, look: 'garden', treeSpacing: 15, treeDensity: 0.55 },
};

export const PRESET_LABELS = {
  standard: 'Standard quarter', dense: 'Dense slums', noble: 'Noble estates', radial: 'Radial rings',
  grid: 'Planned grid', townhouses: 'Townhouses & lots', industrial: 'Docks / industry', market: 'Market (stalls & lots)',
  cemetery: 'Cemetery', park: 'Park / garden',
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

// Prepare hand-drawn roads and rivers (as polylines) for street alignment: thin them out
// so the per-cut distance test stays cheap, and fingerprint them for the cache key.
export function prepGuides(polys) {
  const list = [];
  let h = 17;
  for (const poly of polys) {
    if (!poly || poly.length < 2) continue;
    const pts = [poly[0]];
    for (let i = 1; i < poly.length; i++) if (dist(pts[pts.length - 1], poly[i]) >= 14 || i === poly.length - 1) pts.push(poly[i]);
    if (pts.length < 2) continue;
    list.push({ pts, bb: bbox(pts) });
    for (const p of pts) h = h32(h, (Math.round(p[0] / 3) * 73856093) ^ (Math.round(p[1] / 3) * 19349663));
  }
  return { list, key: list.length + ':' + h };
}

// Density gradient: block size grows or shrinks with distance from a point. "edge" makes the
// blocks tighter toward the outskirts (big blocks in the middle); "center" does the opposite.
// Districts that should stay seamless with each other share the same centre and radius.
function gradientOf(f, shape) {
  const mode = f.gradMode || 'none';
  if (mode === 'none' || !(+f.gradStrength > 0)) return null;
  const c = Array.isArray(f.gradCenter) && f.gradCenter.length === 2 ? f.gradCenter : centroid(shape);
  let r = +f.gradRadius || 0;
  if (!r) for (const p of shape) r = Math.max(r, dist(p, c));
  return { mode, strength: +f.gradStrength, c, r: Math.max(r, 1) };
}

export function districtGen(f, shape, center, guides) {
  const look = f.look || 'blocks';
  const grad = gradientOf(f, shape);
  const key = ['d', f.pattern, f.blockSize, f.streetWidth, f.irregularity, f.warp, f.gridAngle, f.lots, f.courtyards, f.seed, look,
    look === 'garden' ? f.treeSpacing + ',' + f.treeDensity : look === 'cemetery' ? f.graveSpacing : '',
    grad ? [grad.mode, grad.strength, Math.round(grad.c[0]), Math.round(grad.c[1]), Math.round(grad.r)].join(',') : '',
    guides && guides.list.length ? guides.key : '',
    f.pattern === 'radial' ? center.map(Math.round).join(',') : '', shapeKey(shape)].join('|');
  return remember(key, () => {
    const g = subdivide(shape, {
      pattern: f.pattern, blockSize: Math.max(6, +f.blockSize || 38), streetWidth: +f.streetWidth || 4,
      irregularity: +f.irregularity || 0, warp: +f.warp || 0, gridAngle: +f.gridAngle || 0,
      lots: !!f.lots, courtyards: +f.courtyards || 0, seed: (f.seed >>> 0) || 1, center,
      leaves: look !== 'blocks', guides: guides && guides.list.length ? guides.list : null, grad,
    });
    g.decor = look !== 'blocks' ? lookDecor(f, shape, g, look) : null;
    return g;
  });
}

// Trees (garden) or graves (cemetery), scattered inside the generated cells.
function lookDecor(f, shape, g, look) {
  const seed = (f.seed >>> 0) || 1;
  const rnd = mulberry32(seed ^ 0x7ee5), nz = makeNoise((seed ^ 0x3131) >>> 0);
  const trees = [], graves = [];
  const totalArea = g.leaves.reduce((s, l) => s + Math.abs(polyArea(l)), 0);
  const base = look === 'garden' ? Math.max(7, +f.treeSpacing || 15) : Math.max(5, +f.graveSpacing || 8);
  const est = totalArea / (base * base * (look === 'garden' ? 1 : 1.35));
  const sp = est > 9000 ? base * Math.sqrt(est / 9000) : base;
  const dens = Math.max(0, Math.min(1, f.treeDensity == null ? 0.55 : +f.treeDensity));
  for (const leaf of g.leaves) {
    const inner = inflatePoly(leaf, look === 'garden' ? -4 : -5);
    if (polyArea(inner) * polyArea(leaf) <= 0 || Math.abs(polyArea(inner)) < 20) continue;
    if (look === 'garden') {
      const b = bbox(inner);
      for (let y = b.y0 + sp / 2; y < b.y1; y += sp) {
        for (let x = b.x0 + sp / 2; x < b.x1; x += sp) {
          const p = [x + (rnd() - 0.5) * sp * 0.8, y + (rnd() - 0.5) * sp * 0.8];
          const grove = (nz(p[0] / 90, p[1] / 90) + 1) / 2;
          if (rnd() > dens * (0.25 + 1.1 * grove)) continue;
          if (!pointInPoly(p, inner) || !pointInPoly(p, shape)) continue;
          trees.push([p[0], p[1], sp * (0.28 + rnd() * 0.22), rnd()]);
        }
      }
    } else {
      // Rows of headstones aligned with the plot's longest edge.
      let bi = 0, bl = 0;
      for (let i = 0; i < inner.length; i++) { const L = dist(inner[i], inner[(i + 1) % inner.length]); if (L > bl) { bl = L; bi = i; } }
      const e = sub(inner[(bi + 1) % inner.length], inner[bi]), ang = Math.atan2(e[1], e[0]);
      const c = centroid(inner), bb = bbox(inner), R = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
      for (let gu = -R; gu <= R; gu += sp) {
        for (let gv = -R; gv <= R; gv += sp * 1.35) {
          const q = rotate([gu, gv], ang), p = [c[0] + q[0], c[1] + q[1]];
          if (rnd() < 0.07 || !pointInPoly(p, inner) || !pointInPoly(p, shape)) continue;
          graves.push([p[0], p[1], ang + (rnd() - 0.5) * 0.08, sp * 0.36, sp * 0.52]);
        }
      }
    }
  }
  trees.sort((a, b) => a[1] - b[1]);
  return { trees, graves };
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

  // Hand-drawn roads and rivers steer nearby cuts: streets end up running parallel to,
  // or crossing at right angles to, the road they sit next to. The pull fades with distance.
  const infl = bs * 5 + 20;
  const guides = o.guides ? o.guides.filter((gd) => gd.bb.x1 >= sb.x0 - infl && gd.bb.x0 <= sb.x1 + infl && gd.bb.y1 >= sb.y0 - infl && gd.bb.y0 <= sb.y1 + infl) : [];
  function steer(n, c) {
    let bd = infl, dir = null;
    for (const gd of guides) {
      if (c[0] < gd.bb.x0 - bd || c[0] > gd.bb.x1 + bd || c[1] < gd.bb.y0 - bd || c[1] > gd.bb.y1 + bd) continue;
      for (let i = 0; i < gd.pts.length - 1; i++) {
        const r = projSeg(c, gd.pts[i], gd.pts[i + 1]);
        if (r.d < bd) { bd = r.d; dir = norm(sub(gd.pts[i + 1], gd.pts[i])); }
      }
    }
    if (!dir) return n;
    const w = Math.max(0, Math.min(1, 1.15 - bd / infl));
    const pa = dir, pb = perp(dir);
    let t = Math.abs(n[0] * pa[0] + n[1] * pa[1]) >= Math.abs(n[0] * pb[0] + n[1] * pb[1]) ? pa : pb;
    if (n[0] * t[0] + n[1] * t[1] < 0) t = [-t[0], -t[1]];
    return norm([n[0] * (1 - w) + t[0] * w, n[1] * (1 - w) + t[1] * w]);
  }

  // Cut straight across the longest edge, near its middle: gives squarish,
  // T-junctioned blocks instead of slivers.
  function edgeCut(poly, spread, jitter, rnd, steered) {
    const m = poly.length;
    let bi = 0, bl = 0;
    for (let i = 0; i < m; i++) { const L = dist(poly[i], poly[(i + 1) % m]); if (L > bl) { bl = L; bi = i; } }
    const a = poly[bi], b = poly[(bi + 1) % m];
    let n = rotate(norm(sub(b, a)), (rnd() - 0.5) * jitter);
    if (steered && guides.length) n = steer(n, centroid(poly));
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
    let gf = 1;
    if (o.grad) {
      const t = Math.max(0, Math.min(1, dist(centroid(poly), o.grad.c) / o.grad.r)), s = o.grad.strength * 1.2;
      gf = o.grad.mode === 'edge' ? 1 + s * (1 - t) : 1 + s * t;
    }
    if (area < target * gf * gf * (0.6 + rnd() * 0.9) || depth > 60 || count > MAX) { count++; leaf(poly, hash); continue; }
    const r = o.pattern === 'organic'
      ? edgeCut(poly, 0.1 + irr * 0.5, irr * 0.6, rnd, true)
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
