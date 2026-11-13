// Kits: presets that generate a whole group of features at once (districts, roads,
// plazas, buildings...). Each kit's build() returns an array of new features; the editor
// inserts them as one group so they can be moved, duplicated or restyled together.

import { createFeature } from './state.js';
import { PRESETS } from './generate.js';
import { makeRng } from './rng.js';
import { shapePoints } from './shapes.js';
import { add, rotate, fromAngle, dist } from './geom.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A wobbly closed outline around a centre.
function blob(c, rx, ry, n, jit, R, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, k = 1 + (R.next() - 0.5) * 2 * jit;
    pts.push(add(rotate([Math.cos(a) * rx * k, Math.sin(a) * ry * k], rot), c));
  }
  return pts;
}

const seedParam = { k: 'seed', label: 'Layout seed', t: 'seed', def: 1 };

export const KITS = [
  {
    id: 'center',
    name: 'City center',
    desc: 'A civic core of larger buildings and sparse parks, with main roads leading out from a central plaza.',
    params: [
      { k: 'radius', label: 'Size', t: 'range', min: 120, max: 600, step: 5, def: 260 },
      { k: 'roads', label: 'Roads leading out', t: 'range', min: 3, max: 10, step: 1, def: 6 },
      { k: 'ring', label: 'Ring road', t: 'check', def: true },
      { k: 'parks', label: 'Parks', t: 'range', min: 0, max: 5, step: 1, def: 2 },
      { k: 'halls', label: 'Large buildings', t: 'range', min: 0, max: 14, step: 1, def: 7 },
      { ...seedParam },
    ],
    build(c, p) {
      const R = makeRng(p.seed), r = p.radius, out = [];
      const a0 = R.range(0, TAU), nRoads = Math.round(p.roads);
      const angles = Array.from({ length: nRoads }, (_, i) => a0 + (i / nRoads) * TAU + R.range(-0.12, 0.12));
      const at = (a, d) => add(c, fromAngle(a).map((v) => v * d));

      out.push(createFeature('district', blob(c, r, r * R.range(0.92, 1.05), 14, 0.07, R, a0), {
        name: 'City Center', showLabel: true, labelSize: Math.round(clamp(r * 0.13, 24, 60)), labelOffset: [0, r * 0.66],
        ...PRESETS.noble, preset: 'noble', pattern: 'organic', blockSize: Math.round(clamp(r * 0.3, 50, 110)), streetWidth: 6,
        warp: 6, irregularity: 0.45, courtyards: 0.3, borderStreet: 0, seed: R.int(1, 1e9),
      }));

      const parkSpots = [];
      for (let i = 0; i < p.parks; i++) {
        const a = a0 + ((i + 0.5) / p.parks) * TAU + R.range(-0.2, 0.2), d = r * R.range(0.5, 0.6), pr = r * R.range(0.13, 0.18);
        const pc = at(a, d);
        parkSpots.push([pc, pr]);
        out.push(createFeature('district', blob(pc, pr * 1.1, pr, 10, 0.12, R, R.range(0, TAU)), {
          name: '', showLabel: false, ...PRESETS.park, preset: 'park', blockSize: Math.round(pr * 0.9), borderStreet: 3, seed: R.int(1, 1e9),
        }));
      }

      for (const a of angles) {
        const w = Math.round(clamp(r * 0.05, 10, 16));
        out.push(createFeature('road', [c, at(a + R.range(-0.03, 0.03), r * 0.45), at(a + R.range(-0.05, 0.05), r * 0.95), at(a + R.range(-0.06, 0.06), r * 1.5), at(a + R.range(-0.08, 0.08), r * 2.1)],
          { kind: 'avenue', width: w, ruralOutside: false, gates: false, smooth: true }));
      }
      if (p.ring) {
        const ringPts = [];
        for (let i = 0; i < 16; i++) ringPts.push(at((i / 16) * TAU, r * 0.66 * R.range(0.97, 1.03)));
        out.push(createFeature('road', ringPts, { kind: 'avenue', width: 8, closed: true, ruralOutside: false, gates: false, smooth: true }));
      }

      out.push(createFeature('plaza', [c], { radius: Math.round(r * 0.1), monument: 'ring' }));
      if (p.ring) for (const a of angles) out.push(createFeature('plaza', [at(a, r * 0.66)], { radius: 12, monument: R.pick(['fountain', 'dot', 'obelisk']) }));

      const shapes = ['rect', 'square', 'hex', 'oct', 'rect'];
      let tries = 0, placed = 0;
      while (placed < p.halls && tries++ < 200) {
        const a = R.range(0, TAU), d = r * R.range(0.2, 0.88);
        if (angles.some((x) => Math.abs(Math.atan2(Math.sin(a - x), Math.cos(a - x))) < 0.11)) continue;
        const bc = at(a, d);
        if (parkSpots.some(([pc, pr]) => dist(pc, bc) < pr * 1.25)) continue;
        if (dist(bc, c) < r * 0.16) continue;
        const kind = R.pick(shapes), size = r * R.range(0.035, 0.07), ang = (a * 180) / Math.PI + R.range(-10, 10);
        out.push(createFeature('building', shapePoints(kind, bc, size, ang, R.range(1.3, 2)), {
          shape: kind, size, angle: ang, style: 'district', tone: R.pick(['dark', 'normal']),
        }));
        placed++;
      }
      out.push(createFeature('building', shapePoints('star8', c, r * 0.05, 0), { shape: 'star8', size: r * 0.05, style: 'solid' }));
      return out;
    },
  },
  {
    id: 'market',
    name: 'Market square',
    desc: 'A market plaza full of stalls inside a market quarter of small lots, with streets leading in from each side.',
    params: [
      { k: 'size', label: 'Plaza size', t: 'range', min: 40, max: 220, step: 1, def: 90 },
      { k: 'rotation', label: 'Rotation', t: 'range', min: -45, max: 45, step: 1, def: 10 },
      { ...seedParam },
    ],
    build(c, p) {
      const R = makeRng(p.seed), s = p.size, rot = p.rotation, a = (rot * Math.PI) / 180, out = [];
      const q = (x, y) => add(rotate([x, y], a), c);
      out.push(createFeature('district', [q(-s * 2.7, -s * 2.1), q(s * 2.7, -s * 2.1), q(s * 2.7, s * 2.1), q(-s * 2.7, s * 2.1)], {
        name: 'Market Quarter', showLabel: true, labelSize: Math.round(clamp(s * 0.3, 20, 50)), labelOffset: [0, s * 1.75],
        ...PRESETS.market, preset: 'market', gridAngle: rot, blockSize: Math.round(clamp(s * 0.28, 18, 50)), borderStreet: 3, seed: R.int(1, 1e9),
      }));
      for (const [dx, dy, len] of [[1, 0, s * 2.7 + 24], [-1, 0, s * 2.7 + 24], [0, 1, s * 2.1 + 24], [0, -1, s * 2.1 + 24]]) {
        const near = dx ? s * 1.25 : s;
        out.push(createFeature('road', [q(dx * near, dy * near), q(dx * len, dy * len)], { kind: 'street', width: 8, ruralOutside: false, gates: false, smooth: false }));
      }
      out.push(createFeature('plaza', [c], { shape: 'square', radius: s, aspect: 1.25, angle: rot, monument: 'market' }));
      out.push(createFeature('building', shapePoints('rect', q(-s * 0.7, -s * 1.5), s * 0.2, rot, 2.2), { shape: 'rect', size: s * 0.2, aspect: 2.2, angle: rot, style: 'district', tone: 'dark' }));
      return out;
    },
  },
  {
    id: 'cemetery',
    name: 'Cemetery',
    desc: 'Rows of headstones in a walled graveyard with a gate road and a small chapel.',
    params: [
      { k: 'size', label: 'Size', t: 'range', min: 80, max: 320, step: 2, def: 140 },
      { k: 'wall', label: 'Low wall with gate', t: 'check', def: true },
      { k: 'chapel', label: 'Chapel', t: 'check', def: true },
      { ...seedParam },
    ],
    build(c, p) {
      const R = makeRng(p.seed), s = p.size, out = [];
      const pts = blob(c, s * 1.25, s, 14, 0.07, R, 0);
      out.push(createFeature('district', pts, {
        name: 'Cemetery', showLabel: true, labelSize: Math.round(clamp(s * 0.2, 20, 48)), labelOffset: [0, -s * 0.62],
        ...PRESETS.cemetery, preset: 'cemetery', gridAngle: R.range(-10, 10), blockSize: Math.round(clamp(s * 0.6, 50, 100)), borderStreet: 0, seed: R.int(1, 1e9),
      }));
      if (p.wall) out.push(createFeature('wall', pts.map((q) => q.slice()), { name: 'Cemetery Wall', width: 3.5, towerSize: 0, cornerTowers: false, gates: true, smooth: false }));
      out.push(createFeature('road', [add(c, [0, s * 2]), add(c, [0, s * 0.9]), add(c, [0, s * 0.12])], { kind: 'street', width: 8, ruralOutside: false, gates: true, smooth: false }));
      if (p.chapel) out.push(createFeature('building', shapePoints('rect', add(c, [0, -s * 0.1]), s * 0.08, 0, 1.6), { shape: 'rect', size: s * 0.08, aspect: 1.6, style: 'district', tone: 'dark' }));
      return out;
    },
  },
  {
    id: 'park',
    name: 'Park & garden',
    desc: 'A garden of trees and lawns with winding paths, a pond and a central fountain.',
    params: [
      { k: 'size', label: 'Size', t: 'range', min: 80, max: 420, step: 2, def: 170 },
      { k: 'pond', label: 'Pond', t: 'check', def: true },
      { k: 'fountain', label: 'Central fountain', t: 'check', def: true },
      { ...seedParam },
    ],
    build(c, p) {
      const R = makeRng(p.seed), s = p.size, out = [];
      out.push(createFeature('district', blob(c, s, s * 0.88, 16, 0.14, R, R.range(0, TAU)), {
        name: 'Park', showLabel: true, labelSize: Math.round(clamp(s * 0.2, 20, 48)), labelOffset: [0, s * 0.72],
        ...PRESETS.park, preset: 'park', blockSize: Math.round(clamp(s * 0.5, 40, 120)), borderStreet: 3, seed: R.int(1, 1e9),
      }));
      if (p.pond) {
        const pc = add(c, [R.range(-0.3, 0.3) * s, R.range(0.1, 0.35) * s]);
        out.push(createFeature('water', blob(pc, s * 0.26, s * 0.18, 12, 0.14, R, R.range(0, TAU)), { name: '', showLabel: false, coastLines: 1, smooth: true, afterPrev: true }));
      }
      for (let i = 0; i < 3; i++) {
        const a = R.range(0, Math.PI), pts = [];
        for (let t = -1.2; t <= 1.21; t += 0.6) pts.push(add(c, add(rotate([t * s, 0], a), rotate([0, Math.sin(t * 2.2 + i) * s * 0.12], a))));
        out.push(createFeature('road', pts, { kind: 'street', width: 4, ruralOutside: false, gates: false, smooth: true }));
      }
      if (p.fountain) out.push(createFeature('plaza', [c], { radius: Math.max(8, s * 0.07), monument: 'fountain' }));
      return out;
    },
  },
  {
    id: 'keep',
    name: 'Fortified keep',
    desc: 'A walled citadel with towers, an inner courtyard district, a central keep and a gate road.',
    params: [
      { k: 'size', label: 'Size', t: 'range', min: 60, max: 260, step: 2, def: 110 },
      { k: 'sides', label: 'Wall sides', t: 'range', min: 4, max: 12, step: 1, def: 8 },
      { ...seedParam },
    ],
    build(c, p) {
      const R = makeRng(p.seed), s = p.size, n = Math.round(p.sides), out = [];
      const wallPts = Array.from({ length: n }, (_, i) => add(c, fromAngle((i / n) * TAU + Math.PI / n).map((v) => v * s)));
      const wall = createFeature('wall', wallPts, { name: 'Keep Wall', width: 9, towerSize: 7, towerSpacing: 45, smooth: false });
      out.push(createFeature('district', [], {
        name: 'The Keep', showLabel: true, labelSize: Math.round(clamp(s * 0.2, 18, 44)), labelOffset: [0, s * 0.62],
        ...PRESETS.noble, preset: 'noble', pattern: 'organic', blockSize: Math.round(clamp(s * 0.45, 30, 80)), courtyards: 0.4, borderStreet: 0,
        followWall: wall.id, seed: R.int(1, 1e9),
      }));
      out.push(wall);
      out.push(createFeature('road', [add(c, [0, s * 1.9]), add(c, [0, s * 0.95]), add(c, [0, s * 0.45])], { kind: 'avenue', width: 12, ruralOutside: true, gates: true, smooth: false }));
      out.push(createFeature('building', shapePoints('square', c, s * 0.3, R.range(-6, 6)), { shape: 'square', size: s * 0.3, style: 'district', tone: 'dark' }));
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        out.push(createFeature('building', shapePoints('circle', add(c, [dx * s * 0.3, dy * s * 0.3]), s * 0.075, 0), { shape: 'circle', size: s * 0.075, style: 'solid' }));
      }
      return out;
    },
  },
];

export function defaultKitState() {
  const st = {};
  for (const k of KITS) { st[k.id] = {}; for (const p of k.params) st[k.id][p.k] = p.def; }
  return st;
}
