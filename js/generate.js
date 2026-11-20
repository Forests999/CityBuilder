// Procedural street networks.
//
// Every district carves its streets out of ONE city-wide subdivision: a huge
// root square is recursively cut by lines (each cut becomes a street), and a
// district only keeps the cuts that fall inside it. Each cut's randomness is
// derived from its position in that tree rather than from a running random
// stream, so two districts with the same seed and settings produce identical
// streets wherever they meet. Splitting a district therefore leaves no seam.

import { polyArea, centroid, bbox, pointInPoly, splitConvex, extentAlong, fromAngle, perp, norm, sub, dist, lerp, rotate, densify, inflatePoly, projSeg, nearestOnPath } from './geom.js';
import { mulberry32, makeNoise } from './rng.js';

export const PRESETS = {
  standard:   { pattern: 'organic', blockSize: 38, streetWidth: 4,   irregularity: 0.45, warp: 10, lots: false, courtyards: 0,    tone: 'normal', hatch: true, look: 'blocks' },
  dense:      { pattern: 'organic', blockSize: 20, streetWidth: 2.6, irregularity: 0.6,  warp: 7,  lots: false, courtyards: 0,    tone: 'dark',   hatch: true, look: 'blocks' },
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
    // Smoothed direction per segment (averaged over its neighbours) so a bend doesn't fan the streets out.
    const raw = [];
    for (let i = 0; i < pts.length - 1; i++) raw.push(norm(sub(pts[i + 1], pts[i])));
    const dirs = raw.map((_, i) => {
      let x = 0, y = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(raw.length - 1, i + 2); k++) { x += raw[k][0]; y += raw[k][1]; }
      return norm([x, y]);
    });
    list.push({ pts, dirs, bb: bbox(pts) });
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
  // Flowing and ring patterns trace streets along a direction field; they only apply to building districts.
  let pattern = f.pattern === 'flow' ? 'organic' : f.pattern === 'rings' ? 'radial' : f.pattern;
  if (look !== 'blocks' && (pattern === 'flowing' || pattern === 'rings')) pattern = 'organic';
  const useFlow = pattern === 'flowing';
  const focus = Array.isArray(f.flowCenter) && f.flowCenter.length === 2 ? f.flowCenter : (Array.isArray(f.gradCenter) && f.gradCenter.length === 2 ? f.gradCenter : null);
  const key = ['d', pattern, f.blockSize, f.streetWidth, f.irregularity, f.warp, f.gridAngle, f.lots, f.courtyards, f.seed, look,
    look === 'garden' ? f.treeSpacing + ',' + f.treeDensity : look === 'cemetery' ? f.graveSpacing : '',
    grad ? [grad.mode, grad.strength, Math.round(grad.c[0]), Math.round(grad.c[1]), Math.round(grad.r)].join(',') : '',
    f.blockVariety == null ? 0.6 : f.blockVariety, f.coherence == null ? 0.55 : f.coherence, f.streetContrast == null ? 0.35 : f.streetContrast, f.majorCurve == null ? 0.6 : f.majorCurve,
    useFlow ? (focus ? focus.map(Math.round).join(',') : 'c') + ',' + (f.flowRadial == null ? 0.6 : f.flowRadial) : '',
    guides && guides.list.length ? guides.key : '',
    pattern === 'radial' ? center.map(Math.round).join(',') : '', shapeKey(shape)].join('|');
  return remember(key, () => {
    const opts = {
      pattern, blockSize: Math.max(6, +f.blockSize || 38), streetWidth: +f.streetWidth || 4,
      irregularity: +f.irregularity || 0, warp: +f.warp || 0, gridAngle: +f.gridAngle || 0,
      lots: !!f.lots, courtyards: +f.courtyards || 0, seed: (f.seed >>> 0) || 1, center,
      leaves: look !== 'blocks', guides: guides && guides.list.length ? guides.list : null, grad,
      variety: look === 'blocks' ? Math.max(0, Math.min(1, f.blockVariety == null ? 0.6 : +f.blockVariety)) : 0,
      coherence: f.coherence == null ? 0.55 : +f.coherence, contrast: f.streetContrast == null ? 0.35 : +f.streetContrast,
      focus, radial: f.flowRadial == null ? 0.6 : +f.flowRadial,
      curve: f.majorCurve == null ? 0.6 : +f.majorCurve,
    };
    const g = useFlow ? flowSubdivide(shape, opts) : subdivide(shape, opts);
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
  const chords = [], lotChords = [], opens = [], leaves = [], nicks = [];
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
  const infl = bs * 3.5 + 14;
  const guides = o.guides ? o.guides.filter((gd) => gd.bb.x1 >= sb.x0 - infl && gd.bb.x0 <= sb.x1 + infl && gd.bb.y1 >= sb.y0 - infl && gd.bb.y0 <= sb.y1 + infl) : [];
  function steer(n, c) {
    let bd = infl, dir = null;
    for (const gd of guides) {
      if (c[0] < gd.bb.x0 - bd || c[0] > gd.bb.x1 + bd || c[1] < gd.bb.y0 - bd || c[1] > gd.bb.y1 + bd) continue;
      for (let i = 0; i < gd.pts.length - 1; i++) {
        const r = projSeg(c, gd.pts[i], gd.pts[i + 1]);
        if (r.d < bd) { bd = r.d; dir = gd.dirs[i]; }
      }
    }
    if (!dir) return n;
    const w = Math.max(0, Math.min(0.75, 1 - bd / infl));
    const pa = dir, pb = perp(dir);
    let t = Math.abs(n[0] * pa[0] + n[1] * pa[1]) >= Math.abs(n[0] * pb[0] + n[1] * pb[1]) ? pa : pb;
    if (n[0] * t[0] + n[1] * t[1] < 0) t = [-t[0], -t[1]];
    return norm([n[0] * (1 - w) + t[0] * w, n[1] * (1 - w) + t[1] * w]);
  }

  // "Street order": nearby cuts lean toward a shared, slowly changing pair of directions, so streets run
  // roughly parallel with right-angle crossings and neighbouring blocks match, instead of every cell
  // choosing its own angle (which weaves long streets into triangular webs).
  const coh = o.coherence == null ? 0 : Math.max(0, Math.min(1, o.coherence));
  const contrast = o.contrast == null ? 1 : o.contrast;
  const field = makeNoise((o.seed ^ 0x2f6b9d1) >>> 0);
  function orderly(n, c) {
    if (coh <= 0) return n;
    const th = ga + field(c[0] / (bs * 16), c[1] / (bs * 16)) * 0.6;
    const pa = [Math.cos(th), Math.sin(th)], pb = [-pa[1], pa[0]];
    let t = Math.abs(n[0] * pa[0] + n[1] * pa[1]) >= Math.abs(n[0] * pb[0] + n[1] * pb[1]) ? pa : pb;
    if (n[0] * t[0] + n[1] * t[1] < 0) t = [-t[0], -t[1]];
    return norm([n[0] * (1 - coh) + t[0] * coh, n[1] * (1 - coh) + t[1] * coh]);
  }

  // Cut straight across the longest edge, near its middle: gives squarish,
  // T-junctioned blocks instead of slivers.
  function edgeCut(poly, spread, jitter, rnd, steered) {
    const m = poly.length;
    let bi = 0, bl = 0;
    for (let i = 0; i < m; i++) { const L = dist(poly[i], poly[(i + 1) % m]); if (L > bl) { bl = L; bi = i; } }
    const a = poly[bi], b = poly[(bi + 1) % m];
    let n = rotate(norm(sub(b, a)), (rnd() - 0.5) * jitter);
    if (steered) {
      const c0 = centroid(poly);
      n = orderly(n, c0);
      if (guides.length) n = steer(n, c0);
    }
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

  // Small cut-outs that break up the plain polygon look of a block: chamfered or rounded corners,
  // notches in an edge, and shallow curved bites. They are measured from the cell edge, which is a
  // street's centre line, so each starts with the street's half width and then bites into the block.
  function addNicks(poly, hash) {
    const rnd = mulberry32(h32(hash, 31));
    if (rnd() > o.variety || Math.abs(polyArea(poly)) < (bs * 0.55) ** 2) return;
    const m = poly.length, c = centroid(poly), hw = o.streetWidth / 2;
    const count = rnd() < 0.3 ? 2 : 1, usedCorner = new Set();
    for (let k = 0; k < count; k++) {
      const type = rnd();
      if (type < 0.5) {
        // Corner: chamfer (diagonal) or fillet (round).
        const vi = Math.floor(rnd() * m);
        if (usedCorner.has(vi)) continue;
        usedCorner.add(vi);
        const v = poly[vi], a = poly[(vi + m - 1) % m], b = poly[(vi + 1) % m];
        const la = dist(v, a), lb = dist(v, b);
        if (la < bs * 0.4 || lb < bs * 0.4) continue;
        const t = hw + bs * (0.07 + rnd() * 0.16);
        const p1 = lerp(v, a, Math.min(0.45, t / la)), p2 = lerp(v, b, Math.min(0.45, t / lb));
        if (rnd() < 0.5) nicks.push([v, p1, p2]);
        else {
          const ctrl = lerp(v, lerp(p1, p2, 0.5), 0.4), pts = [v, p1];
          for (let s = 1; s < 5; s++) {
            const u = s / 5, w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
            pts.push([w0 * p1[0] + w1 * ctrl[0] + w2 * p2[0], w0 * p1[1] + w1 * ctrl[1] + w2 * p2[1]]);
          }
          pts.push(p2);
          nicks.push(pts);
        }
      } else {
        // Edge: a notch (square-ish bite) or a shallow curved bite.
        const ei = Math.floor(rnd() * m), e0 = poly[ei], e1 = poly[(ei + 1) % m], L = dist(e0, e1);
        if (L < bs * 0.6) continue;
        const d = norm(sub(e1, e0));
        let n = perp(d);
        if (n[0] * (c[0] - e0[0]) + n[1] * (c[1] - e0[1]) < 0) n = [-n[0], -n[1]];
        const at = L * (0.3 + rnd() * 0.4), p = [e0[0] + d[0] * at, e0[1] + d[1] * at];
        const dn = hw + bs * (0.08 + rnd() * 0.16);
        if (type < 0.78) {
          const wn = L * (0.14 + rnd() * 0.16), slant = (rnd() - 0.5) * 0.4 * wn;
          const A = [p[0] - d[0] * wn / 2, p[1] - d[1] * wn / 2], B = [p[0] + d[0] * wn / 2, p[1] + d[1] * wn / 2];
          nicks.push([A, B, [B[0] + n[0] * dn - d[0] * slant, B[1] + n[1] * dn - d[1] * slant], [A[0] + n[0] * dn + d[0] * slant, A[1] + n[1] * dn + d[1] * slant]]);
        } else {
          const cw = L * (0.18 + rnd() * 0.2), pts = [];
          for (let s = -4; s <= 4; s++) {
            const u = s / 4;
            pts.push([p[0] + d[0] * cw * u + n[0] * dn * (1 - u * u), p[1] + d[1] * cw * u + n[1] * dn * (1 - u * u)]);
          }
          nicks.push(pts);
        }
      }
    }
  }

  function leaf(poly, hash) {
    if (o.leaves) leaves.push(poly);
    if (o.lots) lotSplit(poly, 0, h32(hash, 7));
    else if (o.courtyards > 0 && mulberry32(h32(hash, 9))() < o.courtyards * 0.4) { opens.push(poly); return; }
    if (o.variety > 0) addNicks(poly, hash);
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

  // Only the few longest streets bow gently. The bend is a smooth displacement field applied to every
  // point of the district (streets, blocks, nicks), so streets that meet a bowed street move with it and
  // junctions stay joined; the bend is zero at the ends of each bowed street.
  const bows = [];
  if (o.curve > 0 && o.pattern === 'organic') {
    for (const [a, b] of chords) {
      const L0 = dist(a, b);
      if (L0 <= bs * 7) continue;
      let p = a, q = b;
      if (L0 > 4 * Math.max(sb.x1 - sb.x0, sb.y1 - sb.y0)) { const cl = clipSegToBox(a, b, sb.x0 - bs, sb.y0 - bs, sb.x1 + bs, sb.y1 + bs); if (!cl) continue; [p, q] = cl; }
      const L = dist(p, q);
      if (L < bs * 4) continue;
      const hh = h32(Math.round(a[0] * 7 + b[1] * 13), Math.round(a[1] * 5 + b[0] * 11));
      const d = norm(sub(q, p));
      bows.push({ p, d, L, nx: -d[1], ny: d[0], sgn: (hh & 1) ? 1 : -1, ph: ((hh >>> 9) % 100) / 100 * 6.28,
        amp: Math.min(L * 0.05, bs * 1.1) * o.curve * (0.6 + ((hh >>> 3) % 100) / 250) });
    }
  }
  const BR = bs * 4;
  const bowAt = (pt) => {
    let dx = 0, dy = 0;
    for (const w of bows) {
      const rx = pt[0] - w.p[0], ry = pt[1] - w.p[1];
      const s = rx * w.d[0] + ry * w.d[1], t = Math.max(0, Math.min(1, s / w.L));
      const ex = rx - w.d[0] * t * w.L, ey = ry - w.d[1] * t * w.L, dd = Math.hypot(ex, ey);
      if (dd >= BR) continue;
      const fall = 0.5 * (1 + Math.cos(Math.PI * dd / BR));
      const sn = Math.sin(Math.PI * t), k = w.amp * fall * (sn * w.sgn + 0.35 * Math.sin(2 * Math.PI * t + w.ph) * sn);
      dx += w.nx * k; dy += w.ny * k;
    }
    return [dx, dy];
  };

  const fq = 1 / (bs * 3.5), A = o.warp;
  const W0 = (p) => (A ? [p[0] + noise(p[0] * fq, p[1] * fq) * A, p[1] + noise(p[0] * fq + 37.2, p[1] * fq - 11.9) * A] : p);
  const W = bows.length ? (p) => { const q = W0(p), d = bowAt(p); return [q[0] + d[0], q[1] + d[1]]; } : W0;
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
    const k0 = L0 > bs * 7 ? 1.9 : L0 > bs * 3.5 ? 1.35 : L0 < bs * 0.9 ? 0.75 : 1;
    const w = Math.round(o.streetWidth * (1 + (k0 - 1) * contrast) * 10) / 10;
    if (!buckets.has(w)) buckets.set(w, []);
    const ln = line(p, q);
    ln.major = L0 > bs * 3.5;
    buckets.get(w).push(ln);
  }
  return {
    buckets: [...buckets.entries()].sort((a, b) => b[0] - a[0]),
    lots: lotChords.map(([a, b]) => line(a, b)),
    opens: opens.map((p) => densify(p, true, 7).map(W)),
    leaves: leaves.map((p) => densify(p, true, 9).map(W)),
    nicks: nicks.map((p) => p.map(W)),
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

// ---------- city edges ----------
// Points along the district's outline where no other district lies alongside (a "free" edge).
export function freeEdgePoints(shape, others, step = 5) {
  const out = [], n = shape.length, boxes = others.map((s) => bbox(s));
  for (let i = 0; i < n; i++) {
    const a = shape[i], b = shape[(i + 1) % n], k = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let j = 0; j < k; j++) {
      const p = lerp(a, b, (j + 0.5) / k);
      let adjacent = false;
      for (let t = 0; t < others.length && !adjacent; t++) {
        const bb = boxes[t];
        if (p[0] < bb.x0 - 3 || p[0] > bb.x1 + 3 || p[1] < bb.y0 - 3 || p[1] > bb.y1 + 3) continue;
        if (pointInPoly(p, others[t]) || nearestOnPath(p, others[t], true).d < 3) adjacent = true;
      }
      if (!adjacent) out.push(p);
    }
  }
  return out;
}

// Streets stop short of a free edge, each by its own amount, so the city ends in solid frontage with
// staggered dead-ends instead of roads running out to nothing. Results are cached on the generated layout.
export function trimStreets(g, F, bs, fade) {
  const dmax = bs * 1.3 * fade;
  let key = fade + '|' + bs + '|' + F.length;
  for (let i = 0; i < F.length; i += 3) key += '|' + Math.round(F[i][0]) + ',' + Math.round(F[i][1]);
  if (g.trim && g.trim.key === key) return g.trim;
  const cell = Math.max(4, dmax * 1.2), grid = new Map();
  for (const q of F) {
    const k = Math.floor(q[0] / cell) + ',' + Math.floor(q[1] / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(q);
  }
  const near = (p, r) => {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), r2 = r * r;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        const list = grid.get(x + ',' + y);
        if (!list) continue;
        for (const q of list) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < r2) return true;
      }
    }
    return false;
  };
  const buckets = g.buckets.map(([w, lines]) => {
    const kept = [];
    for (const l of lines) {
      const dc = dmax * (0.35 + 0.65 * mulberry32(h32(Math.round(l[0][0] * 3), Math.round(l[0][1] * 3)))());
      // Now and then a street still runs right out to the edge: most major streets, and the odd minor one.
      const lucky = mulberry32(h32(Math.round(l[0][1] * 3) + 17, Math.round(l[0][0] * 3) + 5))();
      if ((l.major && lucky < 0.7) || lucky < 0.06) { kept.push(l); continue; }
      let cur = [];
      for (const p of l) {
        if (!near(p, dc)) cur.push(p);
        else { if (cur.length > 1) kept.push(cur); cur = []; }
      }
      if (cur.length > 1) kept.push(cur);
    }
    return [w, kept];
  });
  // Block bites next to a removed street would float as isolated pockets, so drop those too.
  const nicks = (g.nicks || []).filter((p) => !near(p[0], dmax * 1.1));
  g.trim = { key, buckets, nicks };
  return g.trim;
}

// ---------- flowing streets ----------
// Streets are traced along a direction field instead of cut straight, so they curve: long arcs that
// follow nearby roads and the district edge, concentric rings and spokes around a focus point, and
// gentle noise elsewhere. Major lines run along the field and minor lines across it, spaced apart
// (Jobard-Lefer style) so the result reads as blocks between curving streets.
function flowSubdivide(shape, o) {
  const bs = o.blockSize, sb = bbox(shape);
  const rnd = mulberry32((o.seed ^ 0x6d2b79f5) >>> 0);
  const noise = makeNoise((o.seed ^ 0x1b873593) >>> 0);
  const ga = (o.gridAngle * Math.PI) / 180;
  const coh = o.coherence == null ? 0.55 : o.coherence;
  const mode = o.pattern === 'rings' ? 'rings' : 'flow';
  const C = o.focus || centroid(shape);
  const radial = mode === 'rings' ? 2.6 : Math.max(0, o.radial == null ? 0.6 : o.radial) * 1.8;

  // Hand-drawn roads pull the field parallel to themselves.
  const infl = bs * 3.5 + 14;
  const guides = o.guides ? o.guides.filter((gd) => gd.bb.x1 >= sb.x0 - infl && gd.bb.x0 <= sb.x1 + infl && gd.bb.y1 >= sb.y0 - infl && gd.bb.y0 <= sb.y1 + infl) : [];

  // The district's own outline pulls it parallel to the edge, so streets bend round the boundary.
  const eg = new Map(), ecell = Math.max(6, bs * 3);
  const estep = Math.max(4, bs * 0.4);
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length], L = dist(a, b), t = norm(sub(b, a)), th = Math.atan2(t[1], t[0]);
    const k = Math.max(1, Math.ceil(L / estep));
    for (let j = 0; j < k; j++) {
      const p = lerp(a, b, (j + 0.5) / k), key = Math.floor(p[0] / ecell) + ',' + Math.floor(p[1] / ecell);
      if (!eg.has(key)) eg.set(key, []);
      eg.get(key).push({ p, th });
    }
  }
  function nearEdge(p) {
    const cx = Math.floor(p[0] / ecell), cy = Math.floor(p[1] / ecell);
    let best = null, bd = Infinity;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        const list = eg.get(x + ',' + y);
        if (!list) continue;
        for (const e of list) { const d = (e.p[0] - p[0]) ** 2 + (e.p[1] - p[1]) ** 2; if (d < bd) { bd = d; best = e; } }
      }
    }
    return best ? { d: Math.sqrt(bd), th: best.th } : null;
  }

  function field(p) {
    let sx = 0, sy = 0;
    const add = (th, w) => { sx += w * Math.cos(2 * th); sy += w * Math.sin(2 * th); };
    const dx = p[0] - C[0], dy = p[1] - C[1];
    if (radial > 0 && dx * dx + dy * dy > 4) add(Math.atan2(dy, dx), radial);
    add(ga + noise(p[0] / (bs * 14), p[1] / (bs * 14)) * Math.PI * (0.15 + (1 - coh) * 0.5), mode === 'rings' ? 0.25 : 0.9);
    if (guides.length) {
      let bd = infl, dir = null;
      for (const gd of guides) {
        if (p[0] < gd.bb.x0 - bd || p[0] > gd.bb.x1 + bd || p[1] < gd.bb.y0 - bd || p[1] > gd.bb.y1 + bd) continue;
        for (let i = 0; i < gd.pts.length - 1; i++) {
          const r = projSeg(p, gd.pts[i], gd.pts[i + 1]);
          if (r.d < bd) { bd = r.d; dir = gd.dirs[i]; }
        }
      }
      if (dir) add(Math.atan2(dir[1], dir[0]), 3.2 * Math.exp(-bd / (bs * 3)));
    }
    const ne = nearEdge(p);
    if (ne) add(ne.th, 1.7 * Math.exp(-ne.d / (bs * 2.4)));
    return 0.5 * Math.atan2(sy, sx);
  }

  const step = Math.max(1.6, Math.min(4, bs * 0.12));
  const MAXPTS = 90000;
  let total = 0;
  const inShape = (p) => pointInPoly(p, shape);
  const makeSet = (dsep) => ({ dsep, cell: Math.max(dsep, 4), grid: new Map(), lines: [] });
  const addPt = (s, p) => {
    const k = Math.floor(p[0] / s.cell) + ',' + Math.floor(p[1] / s.cell);
    let a = s.grid.get(k);
    if (!a) { a = []; s.grid.set(k, a); }
    a.push(p);
  };
  const nearPt = (s, p, r) => {
    const r2 = r * r, cx = Math.floor(p[0] / s.cell), cy = Math.floor(p[1] / s.cell);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        const a = s.grid.get(x + ',' + y);
        if (a) for (const q of a) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r2) return true;
      }
    }
    return false;
  };

  // Walk one way from the seed along the field (+off rotates the direction by a quarter turn for minor streets).
  function walk(set, seed, off, sign, other, pStop) {
    const pts = [];
    let p = seed, v = [Math.cos(field(p) + off) * sign, Math.sin(field(p) + off) * sign], closed = false, crossing = false;
    for (let n = 0; n < 1800; n++) {
      let a = field(p) + off, v1 = [Math.cos(a), Math.sin(a)];
      if (v1[0] * v[0] + v1[1] * v[1] < 0) v1 = [-v1[0], -v1[1]];
      const pm = [p[0] + (v1[0] * step) / 2, p[1] + (v1[1] * step) / 2];
      a = field(pm) + off;
      let v2 = [Math.cos(a), Math.sin(a)];
      if (v2[0] * v1[0] + v2[1] * v1[1] < 0) v2 = [-v2[0], -v2[1]];
      const q = [p[0] + v2[0] * step, p[1] + v2[1] * step];
      if (!inShape(q)) { pts.push(q); break; }
      if (nearPt(set, q, set.dsep * 0.5)) break;
      if (n > 12 && dist(q, seed) < step * 1.6) { closed = true; break; }
      if (radial > 0 && dist(q, C) < bs * 0.55) break;   // keep the very middle open (a plaza goes there)
      if (other && pStop > 0) {
        if (nearPt(other, q, step * 1.3)) { if (!crossing) { crossing = true; if (rnd() < pStop) break; } } else crossing = false;
      }
      pts.push(q); p = q; v = v2;
    }
    return { pts, closed };
  }

  function seedList(dsep) {
    const sp = dsep * 0.5, out = [];
    for (let y = sb.y0; y <= sb.y1; y += sp) {
      for (let x = sb.x0; x <= sb.x1; x += sp) {
        const p = [x + (rnd() - 0.5) * sp * 0.8, y + (rnd() - 0.5) * sp * 0.8];
        if (radial > 0 && dist(p, C) < bs * 0.7) continue;
        if (inShape(p)) out.push(p);
      }
    }
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  function lay(set, dsep, off, other, pStop) {
    for (const s of seedList(dsep)) {
      if (total > MAXPTS) break;
      if (nearPt(set, s, dsep * 0.9)) continue;
      const fwd = walk(set, s, off, 1, other, pStop);
      const back = fwd.closed ? { pts: [] } : walk(set, s, off, -1, other, pStop);
      const pts = back.pts.reverse().concat([s], fwd.pts);
      if (fwd.closed) pts.push(s);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
      if (pts.length < 6 || len < bs * 0.8) continue;
      for (const p of pts) addPt(set, p);
      total += pts.length;
      set.lines.push({ pts, len });
    }
  }

  const majorOff = mode === 'rings' ? Math.PI / 2 : 0;
  const major = makeSet(bs * (mode === 'rings' ? 0.95 : 1.15));
  const minor = makeSet(bs * (mode === 'rings' ? 1.7 : 0.85));
  lay(major, major.dsep, majorOff, null, 0);
  lay(minor, minor.dsep, majorOff + Math.PI / 2, major, 0.3);

  // Gentle wobble so nothing is mathematically perfect.
  const fq = 1 / (bs * 3.5), A = (+o.warp || 0) * 0.35;
  const Wp = (p) => (A ? [p[0] + noise(p[0] * fq + 3.3, p[1] * fq) * A, p[1] + noise(p[0] * fq + 41.7, p[1] * fq - 9.9) * A] : p);
  const contrast = o.contrast == null ? 0.35 : o.contrast;
  const lane = o.streetWidth, arcW = Math.round(lane * (1 + 2 * contrast) * 10) / 10;
  const buckets = new Map();
  const put = (w, line) => { if (!buckets.has(w)) buckets.set(w, []); buckets.get(w).push(line); };
  for (const l of major.lines) {
    const arc = l.len > bs * 7 && rnd() < 0.18;
    const line = l.pts.map(Wp);
    line.major = arc || l.len > bs * 10;
    put(arc ? arcW : lane, line);
  }
  for (const l of minor.lines) { const line = l.pts.map(Wp); line.major = false; put(lane, line); }
  return { buckets: [...buckets.entries()].sort((a, b) => b[0] - a[0]), lots: [], opens: [], leaves: [], nicks: [] };
}
