// City generator. Given an outline (or a random shape when none is supplied) it builds a
// whole editable city: wall, districts split from the outline and styled by distance from
// the centre, main roads to the gates, plazas, key buildings, a river, farmland and labels.
// Also provides the polygon-splitting used by "split into N districts".

import * as G from './geom.js';
import { makeRng, makeNoise } from './rng.js';
import { createFeature, blankDoc, sortByDefaultOrder } from './state.js';
import { PRESETS } from './generate.js';
import { shapePoints } from './shapes.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- names ----------
const SYL1 = ['Vel', 'Kar', 'Mor', 'Tal', 'Ess', 'Bran', 'Dor', 'Ul', 'Ser', 'Ath', 'Cal', 'Ven', 'Ost', 'Ira', 'Hal', 'Quel', 'Rhy', 'Zan', 'Thal', 'Gor'];
const SYL2 = ['adel', 'heim', 'mere', 'oth', 'ara', 'gard', 'wyn', 'lis', 'dun', 'avar', 'ost', 'enne', 'ir', 'ath', 'orn', 'ess'];
const WORD = ['Ash', 'Iron', 'Salt', 'Raven', 'Thorn', 'Mill', 'Stone', 'Elder', 'Glass', 'Wick', 'Grey', 'Hollow', 'Lantern',
  'Tallow', 'Cinder', 'Bell', 'Gallow', 'Weaver', 'Rook', 'Amber', 'Marrow', 'Silt', 'Brine', 'Candle', 'Hearth', 'Chain'];
const SUFFIX = ['warrens', 'row', 'market', 'hollow', 'heights', 'end', 'wharf', 'ward', 'field', 'reach', 'court', 'steps', 'yards', 'cross'];
const PREFIX = ['Keep ', 'House ', 'Temple of ', 'Tower of ', 'Hall of '];

const cityName = (R) => R.pick(SYL1) + R.pick(SYL2);
export function districtName(R) {
  const w = R.pick(WORD), s = R.pick(SUFFIX);
  return R.chance(0.5) ? w + s : w + ' ' + s[0].toUpperCase() + s.slice(1);
}

// ---------- geometry helpers ----------
// Farthest distance from c to the outline along a direction.
export function rayDist(c, a, poly) {
  const far = G.add(c, G.scale(G.fromAngle(a), 1e5));
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const r = G.segIntersect(c, far, poly[i], poly[(i + 1) % poly.length]);
    if (r) best = Math.max(best, r.t * 1e5);
  }
  return best;
}

export function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts.map((p) => p.slice());
  const r = G.simplifyPath(pts.concat([pts[0]]), eps);
  r.pop();
  return r.length >= 3 ? r : pts.map((p) => p.slice());
}

export function randomOutline(c, rx, ry, seed, R) {
  const nz = makeNoise((seed * 7 + 3) >>> 0), n = 36, rot = R.range(-0.4, 0.4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + 0.2 * nz(Math.cos(a) * 1.4 + 3, Math.sin(a) * 1.4 + 3) + 0.07 * nz(Math.cos(a) * 3.2 + 9, Math.sin(a) * 3.2 + 9);
    pts.push(G.add(G.rotate([Math.cos(a) * rx * k, Math.sin(a) * ry * k], rot), c));
  }
  return pts;
}

// Keep the part of a polygon on p's side of the bisector between p and q (Sutherland-Hodgman).
function clipHalf(poly, p, q) {
  const n = G.norm(G.sub(p, q)), m = G.lerp(p, q, 0.5), out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a[0] - m[0]) * n[0] + (a[1] - m[1]) * n[1], db = (b[0] - m[0]) * n[0] + (b[1] - m[1]) * n[1];
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) out.push(G.lerp(a, b, da / (da - db)));
  }
  return out;
}

// Split a polygon into one cell per seed (each cell = the points nearest that seed).
export function voronoiSplit(poly, seeds) {
  return seeds.map((s, i) => {
    let cell = poly;
    for (let j = 0; j < seeds.length && cell.length >= 3; j++) if (j !== i) cell = clipHalf(cell, s, seeds[j]);
    if (cell.length < 3) return null;
    const clean = cell.filter((p, k) => G.dist(p, cell[(k + 1) % cell.length]) > 0.5);
    const ring = simplifyClosed(clean, 0.6);
    return Math.abs(G.polyArea(ring)) > 150 ? ring : null;
  });
}

// Where to put the district seeds: a core at the centre plus rings around it, or spread evenly.
export function districtSeeds(c, outline, n, R, mode) {
  if (n <= 1) return [c.slice()];
  if (mode === 'even') {
    const area = Math.abs(G.polyArea(outline)), bb = G.bbox(outline), seeds = [];
    const minD = Math.sqrt(area / n) * 0.7;
    let tries = 0;
    while (seeds.length < n && tries++ < 4000) {
      const p = [R.range(bb.x0, bb.x1), R.range(bb.y0, bb.y1)];
      if (!G.pointInPoly(p, outline)) continue;
      if (seeds.every((s) => G.dist(s, p) >= minD * (tries > 2000 ? 0.5 : 1))) seeds.push(p);
    }
    while (seeds.length < n) seeds.push(G.add(c, [R.range(-20, 20), R.range(-20, 20)]));
    return seeds;
  }
  const seeds = [c.slice()], k = n - 1, a0 = R.range(0, TAU);
  const ring = (m, frac, off) => {
    for (let i = 0; i < m; i++) {
      const a = a0 + off + (i / m) * TAU + (R.range(-0.18, 0.18) * TAU) / m, rd = rayDist(c, a, outline) || 100;
      seeds.push(G.add(c, G.scale(G.fromAngle(a), rd * frac * R.range(0.92, 1.08))));
    }
  };
  if (k <= 6) ring(k, 0.62, 0);
  else { const k1 = Math.round(k * 0.4); ring(k1, 0.48, 0); ring(k - k1, 0.82, TAU / (2 * (k - k1))); }
  return seeds;
}

// Pick a style for each district cell from how far it sits from the centre.
export function assignStyles(cells, c, outline, R) {
  const info = cells.map((cell) => {
    const cc = G.centroid(cell), a = Math.atan2(cc[1] - c[1], cc[0] - c[0]);
    return { t: clamp(G.dist(cc, c) / (rayDist(c, a, outline) || 1), 0, 1.2) };
  });
  const pick = (t) => {
    if (t < 0.3) return 'noble';
    if (t < 0.55) return R.pick(['standard', 'townhouses', 'market', 'noble']);
    if (t < 0.8) return R.pick(['standard', 'townhouses', 'dense', 'standard']);
    return R.pick(['dense', 'industrial', 'dense', 'standard']);
  };
  const styles = info.map((i) => pick(i.t));
  const n = cells.length;
  const swap = (style, lo, hi) => {
    if (styles.includes(style)) return;
    const idx = info.map((x, i) => i).filter((i) => info[i].t >= lo && info[i].t <= hi && styles[i] !== 'noble');
    if (idx.length) styles[R.pick(idx)] = style;
  };
  if (n >= 5) swap('market', 0.25, 0.8);
  if (n >= 6) swap('park', 0.3, 0.85);
  if (n >= 9) swap('cemetery', 0.7, 1.2);
  return styles;
}

// ---------- the generator ----------
// o: { seed, W, H, outline?, size?, districts, gates, walled, river('none'|'through'|'edge'), ring, farmland,
//      density('none'|'edge'|'center'), halls, splitMode, furniture }
export function generateCity(o) {
  const seed = o.seed || 1;
  const R = makeRng(seed), nz = makeNoise(seed >>> 0);
  const W = o.W || 3000, H = o.H || 2200;
  const name = cityName(R);
  const feats = [];

  let outline = o.outline && o.outline.length >= 3 ? o.outline.map((p) => p.slice()) : null;
  if (!outline) {
    const rad = o.size || 650, c0 = [W * 0.5 + R.range(-60, 60), H * 0.52 + R.range(-40, 40)];
    outline = randomOutline(c0, rad * R.range(1.1, 1.3), rad, seed, R);
  }
  const c = G.centroid(outline);
  const Rm = Math.sqrt(Math.abs(G.polyArea(outline)) / Math.PI);
  outline = simplifyClosed(outline, Rm * 0.01);
  const Rmax = Math.max(...outline.map((p) => G.dist(p, c)));

  if (o.walled) {
    feats.push(createFeature('wall', outline, {
      name: name + ' Wall', width: clamp(Rm * 0.012, 5, 10), towerSpacing: Math.round(clamp(Rm * 0.1, 40, 100)),
      towerSize: clamp(Rm * 0.008, 4, 8), gates: true, smooth: false,
    }));
  }

  // Districts
  const n = clamp(Math.round(o.districts || 6), 1, 16);
  const seeds = districtSeeds(c, outline, n, R, o.splitMode || 'center');
  const cells = n === 1 ? [outline] : voronoiSplit(outline, seeds).filter(Boolean);
  const presets = assignStyles(cells, c, outline, R);
  const dens = o.density || 'edge';
  const info = cells.map((cell, i) => ({ cell, preset: presets[i], cc: G.centroid(cell) }));
  info.forEach(({ cell, preset }) => {
    const base = { ...PRESETS[preset] };
    if (base.pattern === 'radial') base.pattern = 'organic';
    const plain = !base.look || base.look === 'blocks';
    feats.push(createFeature('district', cell, {
      name: districtName(R), showLabel: true, labelSize: Math.round(clamp(Math.sqrt(Math.abs(G.polyArea(cell))) * 0.11, 20, 54)),
      ...base, preset, borderStreet: 3.5, seed: R.int(1, 1e9),
      gradMode: plain && dens !== 'none' ? dens : 'none', gradStrength: 0.6, gradCenter: c.slice(), gradRadius: Rmax,
    }));
  });

  // Main roads from the centre to the gates, and an optional ring road
  const gates = clamp(Math.round(o.gates || 6), 2, 12);
  const a0 = R.range(0, TAU);
  const angles = Array.from({ length: gates }, (_, i) => a0 + (i / gates) * TAU + (R.range(-0.14, 0.14) * TAU) / gates);
  const rw = Math.round(clamp(Rm * 0.02, 9, 16));
  const roadLines = [];
  for (const a of angles) {
    const rd = rayDist(c, a, outline) || Rm, dir = G.fromAngle(a), nrm = G.perp(dir);
    const at = (f) => G.add(G.add(c, G.scale(dir, rd * f)), G.scale(nrm, R.range(-1, 1) * rd * 0.03));
    const pts = [c.slice(), at(0.3), at(0.62), at(0.95), at(1.25)];
    if (o.walled) pts.push(at(1.9));
    roadLines.push(pts);
    feats.push(createFeature('road', pts, { kind: 'avenue', width: rw, ruralOutside: !!o.walled, gates: !!o.walled, smooth: true }));
    if (o.walled) {
      feats.push(createFeature('label', [G.add(c, G.scale(dir, rd * 1.14 + 50))], {
        text: R.pick(WORD) + ' Gate', style: 'gate', size: Math.round(clamp(Rm * 0.03, 18, 28)), spacing: 0.12,
      }));
    }
  }
  if (o.ring) {
    const ringPts = [];
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; ringPts.push(G.add(c, G.scale(G.fromAngle(a), (rayDist(c, a, outline) || Rm) * 0.55))); }
    roadLines.push(ringPts.concat([ringPts[0]]));
    feats.push(createFeature('road', ringPts, { kind: 'avenue', width: 8, closed: true, ruralOutside: false, gates: false, smooth: true }));
    for (const a of angles) {
      feats.push(createFeature('plaza', [G.add(c, G.scale(G.fromAngle(a), (rayDist(c, a, outline) || Rm) * 0.55))], { radius: 11, monument: R.pick(['fountain', 'dot', 'obelisk']) }));
    }
  }

  // Central plaza with a citadel star, a market square, and large buildings
  const plazaR = Math.round(clamp(Rm * 0.07, 18, 55));
  feats.push(createFeature('plaza', [c.slice()], { radius: plazaR, monument: 'ring' }));
  feats.push(createFeature('building', shapePoints('star8', c, plazaR * 0.55, 0), { shape: 'star8', size: plazaR * 0.55, style: 'solid' }));
  info.forEach(({ cell, preset, cc }) => {
    if (preset !== 'market') return;
    feats.push(createFeature('plaza', [cc], {
      shape: 'square', radius: Math.round(clamp(Math.sqrt(Math.abs(G.polyArea(cell))) * 0.16, 20, 55)), aspect: 1.3, angle: Math.round(R.range(-15, 15)), monument: 'market',
    }));
  });
  const hallCells = info.filter((i) => ['noble', 'standard', 'townhouses'].includes(i.preset));
  let placed = 0, tries = 0;
  const halls = clamp(Math.round(o.halls == null ? 6 : o.halls), 0, 20);
  while (hallCells.length && placed < halls && tries++ < 300) {
    const { cell } = R.pick(hallCells), bb = G.bbox(cell);
    const p = [R.range(bb.x0, bb.x1), R.range(bb.y0, bb.y1)];
    const size = clamp(Rm * 0.03, 9, 22);
    if (!G.pointInPoly(p, cell) || G.dist(p, c) < plazaR * 2.4) continue;
    if (roadLines.some((l) => G.nearestOnPath(p, l, false).d < rw + size * 1.6)) continue;
    const kind = R.pick(['rect', 'square', 'hex', 'rect']);
    feats.push(createFeature('building', shapePoints(kind, p, size, R.range(-90, 90), R.range(1.3, 2)), { shape: kind, size, style: 'district', tone: R.pick(['dark', 'normal']) }));
    placed++;
  }

  // River
  if (o.river && o.river !== 'none') {
    const th = R.range(0, Math.PI), d = G.fromAngle(th), nrm = G.perp(d), phi = R.range(0.4, 2.7);
    const off = o.river === 'through' ? R.range(-0.22, 0.22) * Rm : (R.chance(0.5) ? 1 : -1) * Rm * 0.8;
    const pts = [];
    for (let t = -2.4; t <= 2.41; t += 0.3) {
      const lat = Math.sin(t * 1.7 + phi) * 0.13 * Rm + nz(t * 0.8, 9.1) * 0.07 * Rm;
      pts.push(G.add(G.add(c, G.add(G.scale(nrm, off), G.scale(d, t * Rm))), G.scale(nrm, lat)));
    }
    feats.push(createFeature('river', pts, { name: 'The ' + cityName(R), width: Math.round(clamp(Rm * 0.09, 26, 80)), labelPos: R.pick([0.4, 0.6]) }));
  }

  // Landmarks
  const spots = info.filter((i) => G.dist(i.cc, c) > plazaR * 2);
  for (let i = 0; i < Math.min(5, spots.length); i++) {
    const { cell, cc } = spots[i], sp = Math.sqrt(Math.abs(G.polyArea(cell))) * 0.3;
    let p = G.add(cc, [R.range(-sp, sp), R.range(-sp, sp)]);
    if (!G.pointInPoly(p, cell)) p = cc;
    feats.push(createFeature('landmark', [p], { name: R.pick(PREFIX) + cityName(R) }));
  }

  // Farmland wedges outside the outline
  if (o.farmland) {
    const start = R.range(0, TAU);
    for (let i = 0; i < 3; i++) {
      const a1 = start + (i * TAU) / 3 + R.range(-0.2, 0.2), a2 = a1 + 0.75, pts = [];
      for (let s = 0; s <= 8; s++) { const a = a1 + ((a2 - a1) * s) / 8; pts.push(G.add(c, G.scale(G.fromAngle(a), (rayDist(c, a, outline) || Rm) * 1.16 + 40))); }
      for (let s = 8; s >= 0; s--) { const a = a1 + ((a2 - a1) * s) / 8; pts.push(G.add(c, G.scale(G.fromAngle(a), (rayDist(c, a, outline) || Rm) * 1.9 + 260))); }
      feats.push(createFeature('farm', pts, { seed: R.int(1, 1e9), parcelSize: Math.round(R.range(90, 140)) }));
    }
  }

  if (o.furniture !== false) {
    feats.push(createFeature('label', [[W * 0.12, H * 0.1]], { text: name, style: 'title', size: 72, spacing: 0.2 }));
    feats.push(createFeature('compass', [[W - 230, H - 240]], { size: 120 }));
  }
  return { name, features: sortByDefaultOrder(feats), center: c, radius: Rm };
}

// A complete fresh map, used for first launch and "New random city".
export function randomCityDoc(seed = Math.floor(Math.random() * 1e9), opts = {}) {
  const doc = blankDoc();
  const gen = generateCity({
    seed, W: doc.meta.width, H: doc.meta.height, districts: 6, gates: 6, walled: true, river: 'through', ring: true,
    farmland: true, density: 'edge', halls: 6, ...opts,
  });
  doc.meta.title = gen.name;
  doc.settings.seed = seed % 100000;
  doc.features = gen.features;
  return doc;
}
