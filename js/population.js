// Rough population estimate. It counts the blocks the street generator actually produces in each
// district, shrinks each by half a street width to get its built-up area, and multiplies by a
// people-per-hectare density (adjustable), a per-style factor, and the district's own weight.
// Parks and cemeteries count as zero. Blocks under a lake, river, plaza, cut-away or building, or
// covered by a district drawn on top, are left out.

import * as G from './geom.js';
import { featureShape, findWalls, riverGeom } from './render.js';
import { districtGen, prepGuides } from './generate.js';

export const STYLE_MULT = {
  dense: 1.8, standard: 1, townhouses: 1.1, market: 0.7, industrial: 0.4, noble: 0.6, grid: 1, radial: 1, park: 0, cemetery: 0,
};

export function estimatePopulation(doc) {
  const feats = doc.features.filter((f) => !f.hidden);
  const shape = new Map(feats.map((f) => [f.id, featureShape(f, doc)]));
  const W = doc.meta.width, H = doc.meta.height;
  const walls = findWalls(doc).filter((w) => shape.has(w.id) && shape.get(w.id).length >= 3);
  const center = walls.length ? G.centroid(shape.get(walls[0].id)) : [W / 2, H / 2];
  const guides = prepGuides(feats.filter((f) => (f.type === 'road' && f.kind !== 'rural' && f.carve !== false) || f.type === 'river')
    .map((f) => shape.get(f.id)).filter((s) => s.length >= 2));
  const mpu = Math.max(0.01, +doc.settings.metersPerUnit || 1);
  const dens = Math.max(0, +doc.settings.popDensity >= 0 ? +doc.settings.popDensity : 150);
  const rows = [];
  let total = 0, blocksTotal = 0, builtTotal = 0;

  feats.forEach((f, idx) => {
    if (f.type !== 'district' || (shape.get(f.id) || []).length < 3) return;
    const sh = shape.get(f.id);
    const g = districtGen(f, sh, center, f.alignRoads ? guides : null);
    // What lies above this district and hides its blocks.
    const covers = [];
    for (const o of feats.slice(idx + 1)) {
      const s = shape.get(o.id) || [];
      if (o.type === 'district' && s.length >= 3) covers.push((p) => G.pointInPoly(p, s));
      else if ((o.type === 'water' || o.type === 'cutout' || o.type === 'building') && s.length >= 3) covers.push((p) => G.pointInPoly(p, s));
      else if (o.type === 'river' && s.length >= 2) { const poly = riverGeom(o, s).poly; covers.push((p) => G.pointInPoly(p, poly)); }
      else if (o.type === 'plaza' && o.points[0]) covers.push((p) => G.dist(p, o.points[0]) < o.radius);
    }
    const hw = (+f.streetWidth || 4) / 2;
    let blocks = 0, built = 0;
    for (const leaf of g.leaves) {
      const c = G.centroid(leaf);
      if (!G.pointInPoly(c, sh) || covers.some((fn) => fn(c))) continue;
      const inner = G.inflatePoly(leaf, -hw);
      const a = G.polyArea(inner) * G.polyArea(leaf) > 0 ? Math.abs(G.polyArea(inner)) : 0;
      blocks++; built += a;
    }
    const look = f.look || 'blocks';
    const styleMult = look !== 'blocks' ? 0 : STYLE_MULT[f.preset] != null ? STYLE_MULT[f.preset] : 1;
    const weight = f.popFactor == null ? 1 : +f.popFactor;
    const hectares = (built * mpu * mpu) / 10000;
    const people = hectares * dens * styleMult * weight;
    rows.push({ id: f.id, name: f.name || 'Unnamed district', blocks, hectares, people, look });
    total += people; blocksTotal += blocks; builtTotal += hectares;
  });
  return { total, blocks: blocksTotal, hectares: builtTotal, rows, density: dens, metersPerUnit: mpu };
}

export function formatPop(n) {
  if (!isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n / 10) * 10 || Math.round(n));
  if (n < 100000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1e6) return Math.round(n / 1000) + 'k';
  return (n / 1e6).toFixed(2).replace(/0$/, '') + 'M';
}
