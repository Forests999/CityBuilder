// Turns the map state (wall, center, settings) into street geometry.
// Layout: spokes radiate from the center landmark, ring roads circle it,
// and each spoke/ring cell is recursively cut by side streets.

const GATE_NAMES = ['Iron Gate', 'Steel Gate', 'Tin Gate', 'Pewter Gate', 'Zinc Gate',
  'Brass Gate', 'Copper Gate', 'Bronze Gate', 'Gold Gate', 'Atium Gate', 'Lead Gate', 'Cadmium Gate'];

function defaultState() {
  const cx = 800, cy = 590, wall = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const r = 1 + 0.12 * Math.sin(3 * a + 1) + 0.08 * Math.sin(5 * a + 2) + 0.04 * Math.sin(9 * a);
    wall.push({ x: cx + Math.cos(a) * 560 * r, y: cy + Math.sin(a) * 400 * r });
  }
  return {
    title: 'LUTHADEL',
    seed: 7,
    center: { x: cx, y: cy },
    wall,
    rivers: [{
      width: 46,
      pts: [{ x: -60, y: 850 }, { x: 300, y: 770 }, { x: 560, y: 840 }, { x: 800, y: 690 },
        { x: 1060, y: 600 }, { x: 1300, y: 470 }, { x: 1680, y: 380 }],
    }],
    spokes: 12,
    rings: 3,
    density: 1.2,
  };
}

function generateCity(s) {
  const rng = mulberry32(s.seed);
  const c = s.center, wall = s.wall;
  const R = (a) => G.rayDist(c, a, wall);
  const pt = (a, sc) => { const r = R(a) * sc; return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }; };

  const n = s.spokes, rings = s.rings;
  const ang = [];
  for (let i = 0; i < n; i++) ang.push((2 * Math.PI * (i + (rng() - 0.5) * 0.4)) / n);

  const s0 = 0.07, scales = [];
  for (let k = 0; k <= rings; k++) scales.push(s0 + (1 - s0) * Math.pow(k / rings, 0.85));

  const spokes = [], gates = [], outside = [];
  for (let i = 0; i < n; i++) {
    const a = ang[i], gate = i % 2 === 0;
    const sp = { a, gate, w: gate ? 8 : 5, from: pt(a, s0), to: pt(a, 1) };
    spokes.push(sp);
    if (gate && R(a) > 0) {
      const name = GATE_NAMES[(i / 2) % GATE_NAMES.length];
      gates.push({ a, p: sp.to, name });
      const len = 260 + rng() * 200;
      outside.push([sp.to, { x: sp.to.x + Math.cos(a + (rng() - 0.5) * 0.3) * len, y: sp.to.y + Math.sin(a + (rng() - 0.5) * 0.3) * len }]);
    }
  }

  const ringLines = [];
  for (let k = 1; k < rings; k++) {
    const pts = [];
    for (let j = 0; j < 96; j++) pts.push(pt((2 * Math.PI * j) / 96, scales[k]));
    ringLines.push({ pts, w: k === Math.ceil(rings / 2) ? 6 : 4.5 });
  }

  // side streets
  const streets = [];
  const minArea = 1700 / s.density;
  const subdivide = (poly, depth) => {
    const A = Math.abs(G.area(poly));
    if (poly.length < 3 || A < minArea * (0.6 + rng() * 0.9) || depth > 9) return;
    const cen = G.centroid(poly);
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of poly) { const dx = p.x - cen.x, dy = p.y - cen.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const major = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const cutAng = major + Math.PI / 2 + (rng() - 0.5) * 0.7;
    const off = (rng() - 0.5) * Math.sqrt(A) * 0.3;
    const p = { x: cen.x + Math.cos(major) * off, y: cen.y + Math.sin(major) * off };
    const sp = G.split(poly, p, { x: Math.cos(cutAng), y: Math.sin(cutAng) });
    if (sp.cuts.length < 2) return;
    const aL = Math.abs(G.area(sp.left)), aR = Math.abs(G.area(sp.right));
    if (Math.min(aL, aR) < A * 0.15) return;
    const dir = { x: Math.cos(cutAng), y: Math.sin(cutAng) };
    const cuts = sp.cuts.slice().sort((u, v) => (u.x * dir.x + u.y * dir.y) - (v.x * dir.x + v.y * dir.y));
    for (let i = 0; i + 1 < cuts.length; i += 2)
      streets.push({ a: cuts[i], b: cuts[i + 1], w: Math.max(1.3, 3.4 - depth * 0.6) });
    subdivide(sp.left, depth + 1);
    subdivide(sp.right, depth + 1);
  };

  for (let i = 0; i < n; i++) {
    const a0 = ang[i];
    let a1 = ang[(i + 1) % n];
    if (a1 <= a0) a1 += 2 * Math.PI;
    for (let k = 0; k < rings; k++) {
      const poly = [];
      const m = 5;
      for (let j = 0; j <= m; j++) poly.push(pt(a0 + ((a1 - a0) * j) / m, scales[k + 1]));
      for (let j = m; j >= 0; j--) poly.push(pt(a0 + ((a1 - a0) * j) / m, scales[k]));
      if (Math.abs(G.area(poly)) > 50) subdivide(poly, 0);
    }
  }

  // faint field lines beyond the walls
  const r2 = mulberry32(s.seed + 101), fields = [];
  for (let i = 0; i < 16; i++) {
    const x = r2() * 1600, y = r2() * 1200, a = r2() * Math.PI, l = 300 + r2() * 600;
    fields.push([{ x: x - Math.cos(a) * l, y: y - Math.sin(a) * l }, { x: x + Math.cos(a) * l, y: y + Math.sin(a) * l }]);
  }

  return { spokes, gates, ringLines, streets, outside, fields };
}
