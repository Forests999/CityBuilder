// Preset outlines for buildings, keeps and monuments. Each returns points around a centre.

import { fromAngle, rotate, add } from './geom.js';

export const BUILDING_SHAPES = [
  ['free', 'Free-form (as drawn)'],
  ['star4', 'Star, 4 points'], ['star5', 'Star, 5 points'], ['star6', 'Star, 6 points'], ['star8', 'Star, 8 points'], ['star12', 'Star, 12 points'],
  ['square', 'Square'], ['rect', 'Rectangle'], ['diamond', 'Diamond'], ['triangle', 'Triangle'],
  ['hex', 'Hexagon'], ['oct', 'Octagon'], ['circle', 'Circle / round tower'], ['cross', 'Cross'],
];

export function shapePoints(kind, c, size, angleDeg, aspect = 1.5, inner = 0.45) {
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
    default: return null;
  }
  return pts.map((p) => add(rotate(p, a0), c));
}
