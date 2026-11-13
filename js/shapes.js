// Preset outlines for buildings, keeps and monuments. Each returns points around a centre.

import { rotate, add, sub, centroid } from './geom.js';

export const BUILDING_SHAPES = [
  ['free', 'Free-form (as drawn)'],
  ['dockComb', 'Docks: quay with piers'], ['dockPier', 'Docks: pier / jetty with T-end'],
  ['star4', 'Star, 4 points'], ['star5', 'Star, 5 points'], ['star6', 'Star, 6 points'], ['star8', 'Star, 8 points'], ['star12', 'Star, 12 points'],
  ['square', 'Square'], ['rect', 'Rectangle'], ['diamond', 'Diamond'], ['triangle', 'Triangle'],
  ['hex', 'Hexagon'], ['oct', 'Octagon'], ['circle', 'Circle / round tower'], ['cross', 'Cross'],
];

export const isDockShape = (k) => k === 'dockComb' || k === 'dockPier';

export function shapePoints(kind, c, size, angleDeg, aspect = 1.5, inner = 0.45, fingers = 4) {
  const a0 = (angleDeg * Math.PI) / 180;
  const ring = (n, r, off = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [Math.cos(off + (i / n) * Math.PI * 2) * r, Math.sin(off + (i / n) * Math.PI * 2) * r]);
  const star = (n) => {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? size * inner : size;
      const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  };
  let pts;
  switch (kind) {
    case 'star4': pts = star(4); break;
    case 'star5': pts = star(5); break;
    case 'star6': pts = star(6); break;
    case 'star8': pts = star(8); break;
    case 'star12': pts = star(12); break;
    case 'square': pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((p) => [p[0] * size, p[1] * size]); break;
    case 'rect': pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((p) => [p[0] * size * aspect, p[1] * size]); break;
    case 'diamond': pts = ring(4, size * 1.2); break;
    case 'triangle': pts = ring(3, size * 1.2); break;
    case 'hex': pts = ring(6, size * 1.1, 0); break;
    case 'oct': pts = ring(8, size * 1.08, Math.PI / 8); break;
    case 'circle': pts = ring(32, size); break;
    case 'cross': {
      const t = size * 0.38;
      pts = [[-t, -size], [t, -size], [t, -t], [size, -t], [size, t], [t, t], [t, size], [-t, size], [-t, t], [-size, t], [-size, -t], [-t, -t]];
      break;
    }
    case 'dockComb': {
      // A quay along the shore with piers reaching out into the water (toward +y before rotation).
      const T = size * 0.2, Lf = size * 0.7 * aspect, n = Math.max(1, Math.round(fingers)), sp = (2 * size) / n, Wf = sp * 0.38;
      pts = [[-size, -T / 2], [size, -T / 2], [size, T / 2]];
      for (let k = n - 1; k >= 0; k--) {
        const xc = -size + sp * (k + 0.5);
        pts.push([xc + Wf / 2, T / 2], [xc + Wf / 2, T / 2 + Lf], [xc - Wf / 2, T / 2 + Lf], [xc - Wf / 2, T / 2]);
      }
      pts.push([-size, T / 2]);
      break;
    }
    case 'dockPier': {
      // A single long jetty with a cross-piece at the far end.
      const Ws = size * 0.14, Bw = size * 0.45 * aspect, Bt = size * 0.16, Ls = size * 2;
      pts = [[-Ws / 2, 0], [Ws / 2, 0], [Ws / 2, Ls - Bt], [Bw, Ls - Bt], [Bw, Ls], [-Bw, Ls], [-Bw, Ls - Bt], [-Ws / 2, Ls - Bt]];
      break;
    }
    default: return null;
  }
  // Dock outlines are lopsided, so centre them on their own middle: re-shaping then never drifts.
  if (isDockShape(kind)) { const cen = centroid(pts); pts = pts.map((p) => sub(p, cen)); }
  return pts.map((p) => add(rotate(p, a0), c));
}
