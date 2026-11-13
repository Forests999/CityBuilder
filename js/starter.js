// "Random city": builds a complete editable starting map (wall, river, avenues,
// districts, labels) that you can then reshape by hand.

import * as G from './geom.js';
import { makeRng, makeNoise } from './rng.js';
import { blankDoc, createFeature, sortByDefaultOrder } from './state.js';
import { PRESETS } from './generate.js';

const SYL1 = ['Vel', 'Kar', 'Mor', 'Tal', 'Ess', 'Bran', 'Dor', 'Ul', 'Ser', 'Ath', 'Cal', 'Ven', 'Ost', 'Ira', 'Hal', 'Quel', 'Rhy', 'Zan', 'Thal', 'Gor'];
const SYL2 = ['adel', 'heim', 'mere', 'oth', 'ara', 'gard', 'wyn', 'lis', 'dun', 'avar', 'ost', 'enne', 'ir', 'ath', 'orn', 'ess'];
const WORD = ['Ash', 'Iron', 'Salt', 'Raven', 'Thorn', 'Mill', 'Stone', 'Elder', 'Glass', 'Wick', 'Grey', 'Hollow', 'Lantern',
  'Tallow', 'Cinder', 'Bell', 'Gallow', 'Weaver', 'Rook', 'Amber', 'Marrow', 'Silt', 'Brine', 'Candle', 'Hearth', 'Chain'];
const SUFFIX = ['warrens', 'row', 'market', 'hollow', 'heights', 'end', 'wharf', 'ward', 'field', 'reach', 'court', 'steps', 'yards', 'cross'];

const cityName = (R) => R.pick(SYL1) + R.pick(SYL2);
function districtName(R) {
  const w = R.pick(WORD), s = R.pick(SUFFIX);
  return R.chance(0.5) ? w + s : w + ' ' + s[0].toUpperCase() + s.slice(1);
}

export function randomCity(seed) {
  const R = makeRng(seed), nz = makeNoise(seed);
  const doc = blankDoc();
  doc.settings.seed = seed % 100000;
  const W = doc.meta.width, H = doc.meta.height;
  const F = doc.features;
  const C = [W * 0.5 + R.range(-80, 80), H * 0.53 + R.range(-40, 40)];
  const rad = R.range(700, 770), ex = R.range(1.15, 1.32), rot = R.range(-0.25, 0.25);
  const wallR = (a) => 1 + 0.15 * nz(Math.cos(a) * 1.4 + 3, Math.sin(a) * 1.4 + 3);
  const at = (a, fr) => { const r = rad * fr * wallR(a); const q = G.rotate([Math.cos(a) * r * ex, Math.sin(a) * r], rot); return [C[0] + q[0], C[1] + q[1]]; };

  const name = cityName(R);
  doc.meta.title = name;

  // Wall
  const nv = R.int(14, 19), wpts = [];
  for (let i = 0; i < nv; i++) { const a = (i / nv) * Math.PI * 2 + R.range(-0.08, 0.08); wpts.push(at(a, R.range(0.97, 1.03))); }
  const wallF = createFeature('wall', wpts, { name: name + ' Wall' });
  F.push(wallF);
  const wallId = wallF.id;

  // Base fill that follows the wall
  F.push(createFeature('district', [], {
    name: 'City fill', showLabel: false, followWall: wallId, borderStreet: 0, preset: 'standard', ...PRESETS.standard, seed: R.int(1, 1e9),
  }));

  // Avenues radiating from the center, through gates, into the countryside
  const nAv = R.int(6, 8), a0 = R.range(0, Math.PI * 2), angles = [];
  for (let i = 0; i < nAv; i++) angles.push(a0 + (i / nAv) * Math.PI * 2 + R.range(-0.18, 0.18));
  const wallDense = G.densify(wpts, true, 10);
  const avenues = angles.map((a) => {
    const pts = [C.slice(), at(a, 0.5), at(a + R.range(-0.07, 0.07), 0.78), at(a + R.range(-0.06, 0.06), 1.15), at(a + R.range(-0.1, 0.1), 2.8)];
    F.push(createFeature('road', pts, { kind: 'avenue', width: Math.round(R.range(11, 14)) }));
    return pts;
  });

  // Ring road with plazas where it meets each avenue
  const ring = [];
  angles.forEach((a, i) => {
    const next = angles[(i + 1) % nAv] + (i === nAv - 1 ? Math.PI * 2 : 0);
    ring.push(at(a, 0.5), at((a + next) / 2, 0.5 + R.range(-0.04, 0.04)));
  });
  F.push(createFeature('road', ring, { kind: 'avenue', width: 9, closed: true, ruralOutside: false, gates: false }));

  // Overlay districts: two wedges between avenues and a noble core
  const wedge = (i, r0, r1) => {
    const a1 = angles[i], a2 = angles[(i + 1) % nAv] + (i === nAv - 1 ? Math.PI * 2 : 0), pts = [];
    for (let s = 0; s <= 8; s++) pts.push(at(a1 + ((a2 - a1) * s) / 8, r1));
    for (let s = 8; s >= 0; s--) pts.push(at(a1 + ((a2 - a1) * s) / 8, r0));
    return pts;
  };
  const sectors = angles.map((_, i) => i);
  const take = () => sectors.splice(R.int(0, sectors.length - 1), 1)[0];
  const slum = take(), docks = take();
  F.push(createFeature('district', wedge(slum, 0.62, 1.25), { name: districtName(R), preset: 'dense', ...PRESETS.dense, clipWall: wallId, borderStreet: 3.5, seed: R.int(1, 1e9), labelSize: 38 }));
  F.push(createFeature('district', wedge(docks, 0.56, 1.25), { name: districtName(R), preset: 'townhouses', ...PRESETS.townhouses, clipWall: wallId, borderStreet: 4, seed: R.int(1, 1e9), labelSize: 38 }));
  const core = [];
  for (let s = 0; s < 16; s++) core.push(at((s / 16) * Math.PI * 2, 0.42));
  F.push(createFeature('district', core, { name: districtName(R), preset: 'noble', ...PRESETS.noble, borderStreet: 0, seed: R.int(1, 1e9), labelSize: 36, labelOffset: [0, rad * 0.24] }));

  // River sweeping past the center, plus a canal
  const th = R.range(0, Math.PI * 2), d = G.fromAngle(th), n = G.perp(d), phi = R.range(0.4, 2.7);
  const c0 = G.add(C, G.scale(n, R.range(0.2, 0.3) * rad));
  const river = [];
  for (let t = -2.8; t <= 2.81; t += 0.25) {
    const lat = Math.sin(t * 1.9 + phi) * 0.18 * rad + nz(t * 0.8, 9.1) * 0.08 * rad;
    river.push(G.add(G.add(c0, G.scale(d, t * rad)), G.scale(n, lat)));
  }
  F.push(createFeature('river', river, { name: 'The ' + cityName(R), width: Math.round(R.range(55, 75)), labelPos: R.pick([0.42, 0.58]) }));
  const ci = R.int(9, 13), cs = river[ci], cdir = G.scale(n, -1), canal = [cs];
  for (let s = 1; s <= 3; s++) canal.push(G.add(G.add(cs, G.scale(cdir, s * rad * 0.13)), G.scale(d, R.range(-40, 40))));
  F.push(createFeature('river', canal, { name: '', showLabel: false, canal: true, width: 15, smooth: false }));

  // Plazas
  F.push(createFeature('plaza', [C.slice()], { radius: 48, monument: 'ring' }));
  angles.forEach((a) => F.push(createFeature('plaza', [at(a, 0.5)], { radius: Math.round(R.range(14, 20)), monument: R.pick(['dot', 'fountain', 'obelisk', 'none']) })));

  // Citadel star in the central plaza
  const star = [];
  for (let s = 0; s < 16; s++) { const r = s % 2 ? 13 : 30; star.push(G.add(C, G.scale(G.fromAngle((s / 16) * Math.PI * 2), r))); }
  F.push(createFeature('building', star, { name: 'Citadel', style: 'accent' }));

  // Gate labels
  for (const av of avenues) {
    const x = G.pathIntersections(G.densify(av, false, 10), false, wallDense, true)[0];
    if (!x) continue;
    const out = G.norm(G.sub(x.p, C));
    F.push(createFeature('label', [G.add(x.p, G.scale(out, 85))], { text: R.pick(WORD) + ' Gate', style: 'gate', size: 26, spacing: 0.12 }));
  }

  // Unnamed sectors get floating district labels
  for (const i of sectors.slice(0, 3)) {
    const a1 = angles[i], a2 = angles[(i + 1) % nAv] + (i === nAv - 1 ? Math.PI * 2 : 0);
    F.push(createFeature('label', [at((a1 + a2) / 2, 0.76)], { text: districtName(R), style: 'district', size: 36, spacing: 0.35, angle: Math.round(R.range(-30, 30)) }));
  }

  // Landmarks
  const PREFIX = ['Keep ', 'House ', 'Temple of ', 'Tower of ', 'Hall of '];
  for (let i = 0; i < 5; i++) {
    const p = at(R.range(0, Math.PI * 2), R.range(0.25, 0.85));
    F.push(createFeature('landmark', [p], { name: R.pick(PREFIX) + cityName(R) }));
  }

  F.push(createFeature('label', [[W * 0.12, H * 0.1]], { text: name, style: 'title', size: 72, spacing: 0.2 }));
  F.push(createFeature('compass', [[W - 230, H - 240]], { size: 120 }));

  // Farmland outside the walls
  for (const i of sectors.slice(-2)) {
    F.push(createFeature('farm', wedge(i, 1.12, 1.6), { seed: R.int(1, 1e9), parcelSize: Math.round(R.range(90, 140)) }));
  }

  doc.features = sortByDefaultOrder(F);
  return doc;
}
