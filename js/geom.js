// Small 2D geometry toolkit. Points are [x, y] arrays.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const scale = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = Math.hypot(a[0], a[1]); return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0]; };
export const perp = (a) => [-a[1], a[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const fromAngle = (a) => [Math.cos(a), Math.sin(a)];
export const rotate = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };

export function polyArea(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function centroid(p) {
  let a = 0, cx = 0, cy = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const u = p[i], v = p[(i + 1) % n];
    const c = u[0] * v[1] - v[0] * u[1];
    a += c; cx += (u[0] + v[0]) * c; cy += (u[1] + v[1]) * c;
  }
  if (Math.abs(a) < 1e-6) {
    let x = 0, y = 0;
    for (const q of p) { x += q[0]; y += q[1]; }
    return [x / n, y / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) {
    if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
  }
  return { x0, y0, x1, y1 };
}

export function pointInPoly(pt, poly) {
  let inside = false;
  const x = pt[0], y = pt[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function projSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + dx * t, a[1] + dy * t];
  return { t, q, d: dist(p, q) };
}

export function nearestOnPath(p, pts, closed) {
  const n = pts.length;
  if (n === 1) return { d: dist(p, pts[0]), i: 0, t: 0, q: pts[0] };
  let best = { d: Infinity, i: -1, t: 0, q: null };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const r = projSeg(p, pts[i], pts[(i + 1) % n]);
    if (r.d < best.d) best = { d: r.d, i, t: r.t, q: r.q };
  }
  return best;
}

export function segIntersect(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-12) return null;
  const ca0 = c[0] - a[0], ca1 = c[1] - a[1];
  const t = (ca0 * s1 - ca1 * s0) / den;
  const u = (ca0 * r1 - ca1 * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: [a[0] + r0 * t, a[1] + r1 * t] };
}

// All crossings between two paths, with the local direction of each path.
export function pathIntersections(A, aClosed, B, bClosed) {
  const out = [];
  const na = A.length, nb = B.length;
  const sa = aClosed ? na : na - 1, sb = bClosed ? nb : nb - 1;
  for (let i = 0; i < sa; i++) {
    const a = A[i], b = A[(i + 1) % na];
    const ax0 = Math.min(a[0], b[0]), ax1 = Math.max(a[0], b[0]);
    const ay0 = Math.min(a[1], b[1]), ay1 = Math.max(a[1], b[1]);
    for (let j = 0; j < sb; j++) {
      const c = B[j], d = B[(j + 1) % nb];
      if (Math.max(c[0], d[0]) < ax0 || Math.min(c[0], d[0]) > ax1 ||
          Math.max(c[1], d[1]) < ay0 || Math.min(c[1], d[1]) > ay1) continue;
      const r = segIntersect(a, b, c, d);
      if (r) out.push({ p: r.p, dirA: norm(sub(b, a)), dirB: norm(sub(d, c)) });
    }
  }
  return out;
}

export function cumLengths(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}

// Point and tangent at arc-length s along an open path.
export function pointAt(pts, cum, s) {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= s) lo = m; else hi = m;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  return { p: lerp(pts[lo], pts[hi], t), dir: norm(sub(pts[hi], pts[lo])) };
}

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
    (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  return [f(0), f(1)];
}

// Catmull-Rom spline through the control points.
export function smoothPoints(pts, closed, spacing = 6) {
  const n = pts.length;
  if (n < 3) return densify(pts, closed, spacing);
  const out = [];
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const m = Math.max(1, Math.ceil(dist(p1, p2) / spacing));
    for (let j = 0; j < m; j++) out.push(cr(p0, p1, p2, p3, j / m));
  }
  if (!closed) out.push(pts[n - 1].slice());
  return out;
}

export function densify(pts, closed, spacing = 10) {
  const n = pts.length;
  if (n < 2) return pts.map((p) => p.slice());
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const m = Math.max(1, Math.ceil(dist(a, b) / spacing));
    for (let j = 0; j < m; j++) out.push(lerp(a, b, j / m));
  }
  if (!closed) out.push(pts[n - 1].slice());
  return out;
}

export function pathNormals(pts, closed) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    let a, b;
    if (closed) { a = pts[(i - 1 + n) % n]; b = pts[(i + 1) % n]; }
    else { a = pts[Math.max(0, i - 1)]; b = pts[Math.min(n - 1, i + 1)]; }
    out.push(perp(norm(sub(b, a))));
  }
  return out;
}

export function extentAlong(poly, n) {
  let mn = Infinity, mx = -Infinity;
  for (const p of poly) {
    const d = p[0] * n[0] + p[1] * n[1];
    if (d < mn) mn = d; if (d > mx) mx = d;
  }
  return [mn, mx];
}

// Cut a convex polygon by the line through p with normal n.
export function splitConvex(poly, p, n) {
  const A = [], B = [], cut = [];
  const m = poly.length;
  for (let i = 0; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    const da = (a[0] - p[0]) * n[0] + (a[1] - p[1]) * n[1];
    const db = (b[0] - p[0]) * n[0] + (b[1] - p[1]) * n[1];
    if (da >= 0) A.push(a);
    if (da <= 0) B.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      A.push(q); B.push(q); cut.push(q);
    }
  }
  if (cut.length < 2 || A.length < 3 || B.length < 3) return null;
  return [A, B, cut[0], cut[1]];
}

// Ramer-Douglas-Peucker simplification of an open path.
export function simplifyPath(pts, eps) {
  if (pts.length < 3) return pts.map((p) => p.slice());
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = projSeg(pts[i], pts[a], pts[b]).d;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map((p) => p.slice());
}

// Push a closed polygon's outline outward by d (mitered, limited). Used to make
// neighbouring districts overlap by a hair so no antialiasing seam shows between them.
export function inflatePoly(poly, d) {
  const n = poly.length;
  if (n < 3) return poly;
  const sgn = polyArea(poly) >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1 = norm(sub(b, a)), e2 = norm(sub(c, b));
    const n1 = [e1[1] * sgn, -e1[0] * sgn], n2 = [e2[1] * sgn, -e2[0] * sgn];
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    const l = Math.hypot(m[0], m[1]);
    if (l < 1e-6) { out.push([b[0] + n1[0] * d, b[1] + n1[1] * d]); continue; }
    m = [m[0] / l, m[1] / l];
    const k = Math.min(2.5, 1 / Math.max(0.2, m[0] * n1[0] + m[1] * n1[1]));
    out.push([b[0] + m[0] * d * k, b[1] + m[1] * d * k]);
  }
  return out;
}
