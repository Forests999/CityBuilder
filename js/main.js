// Editor: tools, mouse/keyboard interaction, panels, file I/O.

import * as S from './state.js';
import * as G from './geom.js';
import { renderMap, releaseLayers, plazaCorners, featureShape, isClosed, isPointType, getColors, findWalls } from './render.js';
import { SCHEMAS, buildForm, el } from './ui.js';
import { randomCity } from './starter.js';
import { shapePoints } from './shapes.js';
import { THEMES, COLOR_KEYS, FONTS } from './themes.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#map');
const ctx = canvas.getContext('2d');
const view = { s: 0.3, ox: 0, oy: 0 };
let dpr = window.devicePixelRatio || 1;

const app = { tool: 'select', sel: null, drawing: null, drag: null, hover: null, snap: null, hits: [], space: false, mouse: null, tab: 'props' };
const ref = { img: null, src: null, opacity: 0.5, visible: true, x: 0, y: 0, scale: 1 };

const ICON = {
  select: '<path d="M5 3l13 8-6 1.5L9 19z"/>',
  wall: '<path d="M4 9l8-5 8 5v8l-8 4-8-4z"/><circle cx="4" cy="9" r="1.6"/><circle cx="12" cy="4" r="1.6"/><circle cx="20" cy="9" r="1.6"/><circle cx="20" cy="17" r="1.6"/><circle cx="4" cy="17" r="1.6"/>',
  district: '<path d="M4 6l9-3 7 6-3 11-11-2z"/><path d="M7 9l8 0M6 13l11 1M10 6l-1 12"/>',
  water: '<path d="M3 8c3-2 5 2 9 0s6 2 9 0M3 13c3-2 5 2 9 0s6 2 9 0M3 18c3-2 5 2 9 0s6 2 9 0"/>',
  river: '<path d="M3 5c6 0 4 6 9 7s4 7 9 7"/><path d="M3 9c4 0 3 5 8 6s4 6 9 6" opacity=".5"/>',
  canal: '<path d="M4 4v16M10 4v16"/><path d="M14 9h7M14 15h7"/>',
  road: '<path d="M4 20L20 4" stroke-width="4"/>',
  street: '<path d="M4 18c5-1 6-8 16-12"/>',
  rural: '<path d="M3 19L21 5" stroke-dasharray="3 2.5"/>',
  plaza: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  plazaSq: '<rect x="7" y="7" width="10" height="10"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  building: '<path d="M5 7h9v4h5v8H5z"/>',
  landmark: '<circle cx="12" cy="9" r="3.5"/><path d="M12 13v8"/>',
  label: '<path d="M5 5h14M12 5v14M9 19h6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M12 4l2.5 8-2.5 8-2.5-8z"/>',
  split: '<path d="M4 6l9-3 7 6-3 11-11-2z" opacity=".5"/><path d="M3 20L21 4" stroke-dasharray="3 2"/>',
  cutout: '<path d="M4 6l9-3 7 6-3 11-11-2z" opacity=".5"/><circle cx="12" cy="12" r="3.5" stroke-dasharray="2.5 2"/>',
  buildingShape: '<path d="M12 3l2.2 5.3 5.6.4-4.3 3.7 1.4 5.5L12 15l-4.9 2.9 1.4-5.5-4.3-3.7 5.6-.4z"/>',
  farm: '<path d="M3 6h18v13H3z"/><path d="M3 12h18M11 6v13"/><path d="M5 8.5h4M5 10h4M13 14h6M13 16.5h6" opacity=".6"/>',
};

const TOOLS = [
  { id: 'select', key: 'v', label: 'Select & move', hint: 'Click to select · drag to move · drag empty space to pan · double-click an edge to add a point · right-click a point to delete it · Alt-click to cycle overlapping items' },
  { id: 'wall', key: 'w', type: 'wall', draw: 'poly', label: 'City wall', hint: 'Click to place wall corners · drag to sketch freehand · click the first point, double-click or Enter to close' },
  { id: 'district', key: 'd', type: 'district', draw: 'poly', label: 'District', hint: 'Outline a district; streets are generated inside it. Click the first point or double-click to finish' },
  { id: 'split', key: 'k', draw: 'line', label: 'Split district', hint: 'Draw a line across a district or farmland to break it in two (only the selected one, if any) · double-click / Enter to cut' },
  { id: 'cutout', key: 'x', type: 'cutout', draw: 'poly', label: 'Cut away', hint: 'Outline an area to cut out of the districts below it (a hole, bay or notch inside a district) · double-click to finish' },
  { id: 'farm', key: 'g', type: 'farm', draw: 'poly', label: 'Farmland', hint: 'Outline farmland; it fills with fields, furrows and hedgerows · double-click to finish' },
  { id: 'water', key: 'a', type: 'water', draw: 'poly', label: 'Lake / sea / bay', hint: 'Outline a body of water (drag to sketch a coastline) · double-click to finish' },
  { id: 'river', key: 'f', type: 'river', draw: 'line', label: 'River', hint: 'Click points along the river (or drag freehand) · double-click / Enter to finish' },
  { id: 'canal', key: 'n', type: 'river', draw: 'line', label: 'Canal', extra: { canal: true, width: 15, name: '', showLabel: false, smooth: false }, hint: 'Click points along the canal · double-click to finish' },
  { id: 'road', key: 'r', type: 'road', draw: 'line', label: 'Avenue', extra: { kind: 'avenue', width: 13 }, hint: 'Click points along the avenue; it snaps to plazas and other roads (hold Alt to not snap) · double-click to finish' },
  { id: 'street', key: 's', type: 'road', draw: 'line', label: 'Street', extra: { kind: 'street', width: 6, ruralOutside: false }, hint: 'Draw a hand-placed street · double-click to finish' },
  { id: 'rural', key: 'u', type: 'road', draw: 'line', label: 'Country road', extra: { kind: 'rural', width: 6 }, hint: 'Thin road through the countryside · double-click to finish' },
  { id: 'plaza', key: 'p', type: 'plaza', draw: 'point', label: 'Round plaza', hint: 'Click to place a round plaza' },
  { id: 'plazaSq', key: 'q', type: 'plaza', draw: 'point', label: 'Square plaza', extra: { shape: 'square', radius: 28, monument: 'none' }, hint: 'Click to place a square plaza; set rotation and proportions in the panel' },
  { id: 'building', key: 'b', type: 'building', draw: 'poly', label: 'Building / keep', hint: 'Outline a large building, keep or monument · double-click to finish' },
  { id: 'buildingShape', key: 'j', type: 'building', draw: 'point', label: 'Building shape (star, square, round…)', extra: { shape: 'star8', size: 28, style: 'solid' }, hint: 'Click to place a preset building shape; change the shape, size and look in the panel' },
  { id: 'landmark', key: 'l', type: 'landmark', draw: 'point', label: 'Landmark', hint: 'Click to place a labelled landmark dot' },
  { id: 'label', key: 't', type: 'label', draw: 'point', label: 'Text label', hint: 'Click to place a label, then type its text in the panel' },
  { id: 'compass', key: 'c', type: 'compass', draw: 'point', label: 'Compass rose', hint: 'Click to place a compass rose' },
];
const toolById = (id) => TOOLS.find((t) => t.id === id);

// ---------- view ----------
const toScreen = (p) => [p[0] * view.s + view.ox, p[1] * view.s + view.oy];
const toWorld = (x, y) => [(x - view.ox) / view.s, (y - view.oy) / view.s];

function fitView() {
  const d = S.getDoc(), r = canvas.getBoundingClientRect();
  if (r.width < 60 || r.height < 60) { requestAnimationFrame(fitView); return; }
  view.s = Math.min((r.width - 40) / d.meta.width, (r.height - 40) / d.meta.height);
  view.ox = (r.width - d.meta.width * view.s) / 2;
  view.oy = (r.height - d.meta.height * view.s) / 2;
  requestRender();
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  requestRender();
}

let pending = false;
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; draw(); });
}

function draw() {
  const doc = S.getDoc();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24 * dpr;
  ctx.fillStyle = '#000';
  ctx.fillRect(view.ox * dpr, view.oy * dpr, doc.meta.width * view.s * dpr, doc.meta.height * view.s * dpr);
  ctx.restore();
  app.hits = [];
  renderMap(ctx, doc, { s: view.s, ox: view.ox, oy: view.oy, dpr, hits: app.hits, ref });
  drawOverlay();
  updateStatus();
}

// ---------- overlay ----------
function strokeScreen(pts, closed, color, width, dash) {
  if (pts.length < 2) return;
  ctx.beginPath();
  pts.forEach((p, i) => { const q = toScreen(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
  if (closed) ctx.closePath();
  ctx.setLineDash(dash || []);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  ctx.setLineDash([]);
}

function outlineOf(f) {
  const doc = S.getDoc();
  if (f.type === 'plaza') return f.shape === 'square' ? plazaCorners(f, 4) : circlePts(f.points[0], f.radius + 4);
  if (f.type === 'landmark') return circlePts(f.points[0], f.size + 6);
  if (f.type === 'compass') return circlePts(f.points[0], f.size);
  if (f.type === 'label') { const h = app.hits.find((x) => x.id === f.id); return h ? h.poly : circlePts(f.points[0], 10); }
  return featureShape(f, doc);
}
function circlePts(c, r) { const o = []; for (let i = 0; i < 32; i++) o.push(G.add(c, G.scale(G.fromAngle((i / 32) * Math.PI * 2), r))); return o; }
const closedOutline = (f) => isClosed(f) || isPointType(f);

function editablePoints(f) {
  if (!f || isPointType(f) || (f.type === 'district' && f.followWall)) return null;
  return f.points;
}

function drawOverlay() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hov = app.hover && app.hover !== app.sel ? S.byId(app.hover) : null;
  if (hov && app.tool === 'select' && !app.drag) strokeScreen(outlineOf(hov), closedOutline(hov), 'rgba(80,170,255,.55)', 2);
  const f = app.sel ? S.byId(app.sel) : null;
  if (f) {
    const o = outlineOf(f);
    strokeScreen(o, closedOutline(f), 'rgba(0,0,0,.5)', 4);
    strokeScreen(o, closedOutline(f), '#4db0ff', 2, [6, 4]);
    const pts = editablePoints(f);
    if (pts) {
      if (f.smooth) strokeScreen(pts, isClosed(f), 'rgba(77,176,255,.45)', 1);
      for (const p of pts) {
        const q = toScreen(p);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a6fd1'; ctx.lineWidth = 1.5;
        ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8); ctx.strokeRect(q[0] - 4, q[1] - 4, 8, 8);
      }
    }
  }
  if (app.drawing) {
    const t = toolById(app.drawing.tool);
    const pts = app.drawing.pts.concat(app.mouse ? [app.snap || app.mouse] : []);
    strokeScreen(pts, false, 'rgba(0,0,0,.6)', 4);
    strokeScreen(pts, false, '#ffb547', 2);
    if (t.draw === 'poly' && pts.length > 2) strokeScreen([pts[pts.length - 1], pts[0]], false, '#ffb547', 1.5, [5, 5]);
    for (const p of app.drawing.pts) {
      const q = toScreen(p);
      ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = '#ffb547'; ctx.fill();
    }
  }
  if (app.snap) {
    const q = toScreen(app.snap);
    ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#59e38b'; ctx.lineWidth = 2; ctx.stroke();
  }
}

// ---------- hit testing ----------
function hitTest(w) {
  const doc = S.getDoc(), tol = 7 / view.s, out = [];
  const visible = (f) => f && !f.hidden && !f.locked;
  for (let i = app.hits.length - 1; i >= 0; i--) {
    const h = app.hits[i], f = S.byId(h.id);
    if (visible(f) && G.pointInPoly(w, h.poly)) out.push({ id: h.id, kind: h.kind });
  }
  const fs = doc.features.filter(visible).reverse();
  for (const f of fs) {
    const p = f.points[0];
    if (!p) continue;
    if ((f.type === 'landmark' && G.dist(w, p) < f.size + tol) || (f.type === 'plaza' && (f.shape === 'square' ? G.pointInPoly(w, plazaCorners(f, tol)) : G.dist(w, p) < f.radius + tol)) ||
        (f.type === 'compass' && G.dist(w, p) < f.size)) out.push({ id: f.id, kind: 'move' });
  }
  for (const f of fs) {
    if (!['road', 'river', 'wall'].includes(f.type)) continue;
    const sh = featureShape(f, doc);
    if (sh.length < 2) continue;
    const half = f.type === 'road' && f.kind === 'rural' ? 2 : f.width / 2;
    if (G.nearestOnPath(w, sh, isClosed(f)).d < half + tol) out.push({ id: f.id, kind: 'move' });
  }
  // Areas: topmost layer first.
  for (const f of fs) {
    if (!['building', 'district', 'water', 'farm', 'cutout'].includes(f.type)) continue;
    const sh = featureShape(f, doc);
    if (sh.length >= 3 && G.pointInPoly(w, sh)) out.push({ id: f.id, kind: 'move' });
  }
  const seen = new Set();
  return out.filter((h) => (seen.has(h.id + h.kind) ? false : seen.add(h.id + h.kind)));
}

function handleAt(sx, sy) {
  const f = app.sel && S.byId(app.sel);
  const pts = editablePoints(f);
  if (!pts) return -1;
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = toScreen(pts[i]);
    if (Math.abs(q[0] - sx) < 7 && Math.abs(q[1] - sy) < 7) return i;
  }
  return -1;
}

function snapPoint(w, disabled, skipId) {
  app.snap = null;
  if (disabled) return w;
  const tol = 10 / view.s;
  let best = null, bd = tol;
  for (const f of S.getDoc().features) {
    if (f.hidden || f.id === skipId || f.type === 'label' || f.type === 'compass' || f.type === 'landmark') continue;
    for (const p of f.points || []) { const d = G.dist(p, w); if (d < bd) { bd = d; best = p; } }
  }
  if (best) { app.snap = best.slice(); return best.slice(); }
  return w;
}

// ---------- selection & editing ----------
function select(id) {
  app.sel = id;
  if (id && app.tab !== 'layers') app.tab = 'props';
  renderPanel();
  requestRender();
}

function setTool(id) {
  if (app.drawing) finishDrawing();
  app.tool = id;
  if (id !== 'split') app.splitTarget = null;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
  canvas.style.cursor = id === 'select' ? 'default' : 'crosshair';
  if (!app.sel) renderPanel();
  updateStatus();
}

function finishDrawing() {
  const d = app.drawing;
  app.drawing = null; app.snap = null;
  if (!d) return;
  const t = toolById(d.tool);
  const pts = [];
  for (const p of d.pts) if (!pts.length || G.dist(pts[pts.length - 1], p) > 3 / view.s) pts.push(p);
  if (t.draw === 'poly' && pts.length > 3 && G.dist(pts[0], pts[pts.length - 1]) < 3 / view.s) pts.pop();
  const min = t.draw === 'poly' ? 3 : 2;
  if (pts.length < min) { requestRender(); return; }
  if (t.id === 'split') { splitAreas(pts, d.target); return; }
  const f = S.createFeature(t.type, pts, t.extra || {});
  S.insertFeature(f);
  app.sel = f.id;
  S.commit();
}

// Cut a polygon in two along a polyline that crosses its boundary.
function splitPolygon(P, L) {
  const n = P.length, hits = [];
  for (let i = 0; i < L.length - 1; i++) {
    for (let e = 0; e < n; e++) {
      const r = G.segIntersect(L[i], L[i + 1], P[e], P[(e + 1) % n]);
      if (r) hits.push({ li: i, t: r.t, e, u: r.u, p: r.p });
    }
  }
  hits.sort((a, b) => a.li - b.li || a.t - b.t);
  const uniq = hits.filter((h, i) => i === 0 || G.dist(h.p, hits[i - 1].p) > 1e-6);
  if (uniq.length < 2) return null;
  const h1 = uniq[0], h2 = uniq[1];
  const inner = L.slice(h1.li + 1, h2.li + 1).map((p) => p.slice());
  const walk = (a, b) => {
    const out = [a.p];
    if (a.e === b.e && b.u > a.u) { out.push(b.p); return out; }
    let k = a.e;
    do { k = (k + 1) % n; out.push(P[k].slice()); } while (k !== b.e);
    out.push(b.p);
    return out;
  };
  const A = walk(h1, h2).concat(inner.slice().reverse());
  const B = walk(h2, h1).concat(inner);
  if (Math.abs(G.polyArea(A)) < 50 || Math.abs(G.polyArea(B)) < 50) return null;
  return [A, B, [h1.p.slice(), ...inner, h2.p.slice()]];
}

function splitAreas(line, targetId) {
  const doc = S.getDoc();
  const targets = targetId ? [S.byId(targetId)].filter(Boolean)
    : doc.features.filter((f) => (f.type === 'district' || f.type === 'farm') && !f.hidden);
  let made = null, count = 0;
  for (const f of targets) {
    // Split the outline as it is actually drawn (a smoothed or wall-following shape is not its raw points),
    // so the two pieces fit the original edge exactly and meet each other along the cut with no gap.
    const exact = !!(f.followWall || f.smooth);
    const P = exact ? featureShape(f, doc) : f.points;
    if (!P || P.length < 3) continue;
    const res = splitPolygon(P, line);
    if (!res) continue;
    let parts = [res[0], res[1]];
    const cut = res[2];
    if (exact) parts = parts.map((p) => G.simplifyPath(p, 0.7));
    if (f.followWall) { if (!f.clipWall) f.clipWall = f.followWall; f.followWall = ''; }
    if (exact) f.smooth = false;
    f.points = parts[0];
    f.locked = false;
    const c = JSON.parse(JSON.stringify(f));
    c.id = S.newId();
    c.points = parts[1];
    if (c.name) c.name = c.name === 'City fill' ? 'New District' : c.name + ' (part)';
    if (f.name === 'City fill') f.name = 'District';
    doc.features.splice(doc.features.indexOf(f) + 1, 0, c);
    made = c.id; count++;
    // A street along the cut, wider than the district's own streets, so the new boundary reads as a main road.
    if (f.type === 'district' && cut.length >= 2) {
      const w = Math.max(8, (+f.borderStreet || 0) * 2.2);
      const pts = cut.map((p) => p.slice());
      const trim = (a, b) => { const d = G.dist(a, b), t = Math.min(0.4, (w * 0.3) / (d || 1)); return G.lerp(a, b, t); };
      pts[0] = trim(pts[0], pts[1]);
      pts[pts.length - 1] = trim(pts[pts.length - 1], pts[pts.length - 2]);
      S.insertFeature(S.createFeature('road', pts, { kind: 'street', width: w, ruralOutside: false, gates: false, smooth: false }));
    }
  }
  if (!count) { toast('The line must cross all the way through a district (or farmland) to split it.'); requestRender(); return; }
  app.sel = made;
  setTool('select');
  S.commit();
  toast(count === 1 ? 'Split into two; a wider street runs along the cut (delete it in Layers if unwanted). The new piece is selected.' : `Split ${count} areas.`);
}

function placePoint(t, w) {
  const f = S.createFeature(t.type, [w], t.extra || {});
  if (t.type === 'label') f.text = 'New Label';
  if (t.type === 'building') f.points = shapePoints(f.shape, w, f.size, f.angle, f.aspect, f.inner) || [w];
  S.insertFeature(f);
  app.sel = f.id;
  app.tab = 'props';
  S.commit();
  if (t.type === 'label') setTimeout(() => { const ta = document.querySelector('#panelBody textarea'); if (ta) { ta.focus(); ta.select(); } }, 0);
}

function deleteSelected() {
  if (!app.sel) return;
  const doc = S.getDoc();
  doc.features = doc.features.filter((f) => f.id !== app.sel);
  app.sel = null;
  S.commit();
}

function duplicateSelected() {
  const f = app.sel && S.byId(app.sel);
  if (!f) return;
  const c = JSON.parse(JSON.stringify(f));
  c.id = S.newId();
  c.points = c.points.map((p) => [p[0] + 30, p[1] + 30]);
  if (c.type === 'district') { c.seed = Math.floor(Math.random() * 1e9); c.locked = false; }
  const doc = S.getDoc();
  doc.features.splice(doc.features.indexOf(f) + 1, 0, c);
  app.sel = c.id;
  S.commit();
}

const ctxHelpers = {
  haloDefault() { return S.getDoc().settings.haloWidth ?? 0.34; },
  // Rebuild a preset-shaped building around its current centre.
  reshapeBuilding(f) {
    if (f.shape === 'free' || !f.points.length) return;
    const c = f.points.length >= 3 ? G.centroid(f.points) : f.points[0];
    const pts = shapePoints(f.shape, c, f.size, f.angle, f.aspect, f.inner);
    if (pts) { f.points = pts; f.smooth = false; }
  },
  wallOptions() {
    return S.getDoc().features.filter((f) => f.type === 'wall' && f.closed !== false).map((w, i) => [w.id, w.name || `Wall ${i + 1}`]);
  },
  unlinkWall(f, prev) {
    if (!f.followWall && f.points.length < 3) {
      const w = S.byId(prev) || findWalls(S.getDoc())[0];
      if (w) f.points = JSON.parse(JSON.stringify(w.points));
    }
  },
  startSplit(f) {
    setTool('split');
    app.splitTarget = f.id;
    toast('Draw a line across the area, then double-click (or press Enter).');
  },
  // Wall only along the borders that don't touch another district (open wall segments).
  wallFromFreeEdges(f) {
    const doc = S.getDoc();
    const own = featureShape(f, doc);
    if (own.length < 3) return;
    const P = G.densify(own, true, 4), n = P.length;
    const others = doc.features.filter((o) => o !== f && o.type === 'district' && !o.hidden).map((o) => featureShape(o, doc)).filter((s) => s.length >= 3);
    const tol = 3;
    const exposed = P.map((p, i) => {
      const m = G.lerp(p, P[(i + 1) % n], 0.5);
      return !others.some((s) => G.pointInPoly(m, s) || G.nearestOnPath(m, s, true).d < tol);
    });
    if (!exposed.some(Boolean)) { toast('Every edge of this district touches another district, so there is nothing to wall.'); return; }
    if (exposed.every(Boolean)) { ctxHelpers.wallFromArea(f); return; }
    // Start walking from a shared edge so no run wraps around the start of the list.
    const start = exposed.findIndex((e) => !e);
    const runs = [];
    let cur = null;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (exposed[i]) { if (!cur) cur = [P[i]]; cur.push(P[(i + 1) % n]); }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    let last = null, made = 0;
    for (const run of runs) {
      const pts = G.simplifyPath(run, 1.2);
      if (G.cumLengths(pts).pop() < 20) continue;
      last = S.createFeature('wall', pts, { name: (f.name || 'District') + ' Wall', closed: false });
      S.insertFeature(last);
      made++;
    }
    if (!made) return;
    app.sel = last.id;
    S.commit();
    toast(`Added ${made} wall segment${made > 1 ? 's' : ''} along the free edges.`);
  },
  wallFromArea(f) {
    const doc = S.getDoc();
    const src = f.followWall ? S.byId(f.followWall) : f;
    if (!src || src.points.length < 3) return;
    const w = S.createFeature('wall', src.points, { name: (f.name || 'District') + ' Wall', smooth: !!src.smooth });
    S.insertFeature(w);
    if (!f.followWall) f.clipWall = w.id;
    app.sel = w.id;
    S.commit();
    toast('Wall created — it is selected so you can adjust towers and thickness.');
  },
};

// ---------- pointer input ----------
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const sx = e.offsetX, sy = e.offsetY, w = toWorld(sx, sy);
  const tool = toolById(app.tool);
  if (e.button === 1 || app.space || (e.button === 2 && !app.drawing && handleAt(sx, sy) < 0)) {
    app.drag = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy, button: e.button };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button === 2) {
    if (app.drawing) { finishDrawing(); return; }
    const i = handleAt(sx, sy), f = S.byId(app.sel);
    if (i >= 0 && f.points.length > (isClosed(f) ? 3 : 2)) { f.points.splice(i, 1); S.commit(); }
    return;
  }
  if (e.button !== 0) return;

  if (tool.draw === 'point') { placePoint(tool, snapPoint(w, true)); return; }
  if (tool.draw) {
    const p = snapPoint(w, e.altKey);
    if (!app.drawing) {
      const sel = app.sel && S.byId(app.sel);
      const target = tool.id === 'split' ? app.splitTarget || (sel && (sel.type === 'district' || sel.type === 'farm') ? sel.id : null) : null;
      app.drawing = { tool: tool.id, pts: [p], target };
    }
    else {
      const first = app.drawing.pts[0];
      if (tool.draw === 'poly' && app.drawing.pts.length >= 3 && G.dist(toScreen(first), [sx, sy]) < 10) { finishDrawing(); return; }
      app.drawing.pts.push(p);
    }
    app.drag = { mode: 'freehand', sx, sy, moved: false };
    requestRender();
    return;
  }

  // select tool
  const hi = handleAt(sx, sy);
  if (hi >= 0) {
    app.drag = { mode: 'vertex', index: hi, id: app.sel, moved: false };
    return;
  }
  const hits = hitTest(w);
  if (!hits.length) {
    if (app.sel) select(null);
    app.drag = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy, button: 0 };
    canvas.style.cursor = 'grabbing';
    return;
  }
  let hit = hits[0];
  if (e.altKey) {
    const idx = hits.findIndex((h) => h.id === app.sel);
    if (idx >= 0) hit = hits[(idx + 1) % hits.length];
  }
  if (hit.id !== app.sel) select(hit.id);
  const f = S.byId(hit.id);
  app.drag = {
    mode: hit.kind === 'offset' ? 'offset' : hit.kind === 'pathpos' ? 'pathpos' : 'move',
    id: f.id, start: w, moved: false,
    orig: JSON.parse(JSON.stringify(f.points)), origOffset: (f.labelOffset || [0, 0]).slice(),
  };
});

canvas.addEventListener('pointermove', (e) => {
  const sx = e.offsetX, sy = e.offsetY, w = toWorld(sx, sy);
  app.mouse = w;
  const d = app.drag;
  if (!d) {
    if (app.drawing) snapPoint(w, e.altKey);
    else app.snap = null;
    if (app.tool === 'select') {
      const hits = hitTest(w);
      app.hover = hits.length ? hits[0].id : null;
      canvas.style.cursor = handleAt(sx, sy) >= 0 ? 'pointer' : hits.length ? 'move' : 'default';
    }
    requestRender();
    return;
  }
  if (d.mode === 'pan') {
    view.ox = d.ox + sx - d.sx; view.oy = d.oy + sy - d.sy;
    requestRender();
    return;
  }
  if (d.mode === 'freehand') {
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) > 5) d.moved = true;
    if (d.moved && app.drawing) {
      const last = app.drawing.pts[app.drawing.pts.length - 1];
      if (G.dist(last, w) > 16 / view.s) app.drawing.pts.push(w);
    }
    requestRender();
    return;
  }
  const f = S.byId(d.id);
  if (!f) return;
  d.moved = true;
  if (d.mode === 'vertex') {
    f.points[d.index] = snapPoint(w, e.altKey, f.id);
  } else if (d.mode === 'move') {
    if (f.type === 'district' && f.followWall) return;
    const dx = w[0] - d.start[0], dy = w[1] - d.start[1];
    f.points = d.orig.map((p) => [p[0] + dx, p[1] + dy]);
  } else if (d.mode === 'offset') {
    f.labelOffset = [d.origOffset[0] + w[0] - d.start[0], d.origOffset[1] + w[1] - d.start[1]];
  } else if (d.mode === 'pathpos') {
    const sh = featureShape(f, S.getDoc());
    const r = G.nearestOnPath(w, sh, false), cum = G.cumLengths(sh);
    f.labelPos = Math.max(0, Math.min(1, (cum[r.i] + G.dist(sh[r.i], r.q)) / cum[cum.length - 1]));
  }
  S.touch();
});

canvas.addEventListener('pointerup', () => {
  const d = app.drag;
  app.drag = null;
  if (!d) return;
  if (d.mode === 'pan') { canvas.style.cursor = app.tool === 'select' ? 'default' : 'crosshair'; return; }
  if (d.mode === 'freehand') return;
  app.snap = null;
  if (d.moved) S.commit();
});

canvas.addEventListener('dblclick', (e) => {
  if (app.drawing) { finishDrawing(); return; }
  if (app.tool !== 'select') return;
  const f = app.sel && S.byId(app.sel);
  const pts = editablePoints(f);
  if (!pts || pts.length < 2) return;
  const w = toWorld(e.offsetX, e.offsetY);
  const r = G.nearestOnPath(w, pts, isClosed(f));
  if (r.d * view.s > 25) return;
  pts.splice(r.i + 1, 0, r.q);
  S.commit();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const sx = e.offsetX, sy = e.offsetY, w = toWorld(sx, sy);
  const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  view.s = Math.max(0.03, Math.min(12, view.s * factor));
  view.ox = sx - w[0] * view.s; view.oy = sy - w[1] * view.s;
  requestRender();
}, { passive: false });

// ---------- keyboard ----------
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveJSON(); return; }
  if (typing()) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) S.redo(); else S.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); S.redo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.key === ' ') { app.space = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (app.drawing) { app.drawing = null; app.snap = null; requestRender(); }
    else if (app.tool !== 'select') setTool('select');
    else select(null);
    return;
  }
  if (e.key === 'Enter' && app.drawing) { finishDrawing(); return; }
  if (e.key === 'Backspace' && app.drawing) { app.drawing.pts.pop(); if (!app.drawing.pts.length) app.drawing = null; requestRender(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.sel) { deleteSelected(); return; }
  if (e.key === 'f' && e.shiftKey) { fitView(); return; }
  if (mod || e.altKey) return;
  const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
  if (t) setTool(t.id);
  if (e.key === '?') toggleHelp(true);
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { app.space = false; canvas.style.cursor = app.tool === 'select' ? 'default' : 'crosshair'; } });

// ---------- panels ----------
function renderTools() {
  const nav = $('#tools');
  nav.innerHTML = '';
  for (const t of TOOLS) {
    const b = el('button', { class: 'tool' + (t.id === app.tool ? ' active' : ''), 'data-tool': t.id, title: `${t.label} (${t.key.toUpperCase()})` });
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICON[t.id]}</svg>`;
    b.addEventListener('click', () => setTool(t.id));
    nav.append(b);
    if (t.id === 'select' || t.id === 'water' || t.id === 'rural') nav.append(el('div', { class: 'sep' }));
  }
}

const colorDefault = (k, obj) => {
  const C = getColors(S.getDoc());
  if (k === 'color' && obj && obj.type === 'district') return { dark: C.blockDark, light: C.blockLight, park: C.park }[obj.tone] || C.block;
  if (k === 'color' && obj && obj.type === 'label') return C.label;
  return C[k] || '#888888';
};

function renderPanel() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === app.tab));
  const body = $('#panelBody');
  body.innerHTML = '';
  if (app.tab === 'props') renderProps(body);
  else if (app.tab === 'layers') renderLayers(body);
  else renderMapSettings(body);
}

function renderProps(body) {
  const f = app.sel && S.byId(app.sel);
  if (!f) {
    const t = toolById(app.tool);
    body.append(
      el('h3', {}, t.label),
      el('p', { class: 'info' }, t.hint),
      el('div', { class: 'heading' }, 'Getting around'),
      el('ul', { class: 'tips' },
        el('li', {}, 'Scroll to zoom, drag empty space (or hold Space / right-drag) to pan.'),
        el('li', {}, 'Click anything on the map to edit it here; locked layers are selectable from the Layers tab.'),
        el('li', {}, 'Districts generate their own streets — try the presets and the 🎲 Reroll button.'),
        el('li', {}, 'Everything autosaves in this browser. Use Save to keep a .json file.')),
    );
    return;
  }
  const head = el('div', { class: 'prop-head' },
    el('h3', {}, S.TYPE_LABELS[f.type]),
    el('div', { class: 'btns' },
      el('button', { title: 'Duplicate (Ctrl+D)', onclick: duplicateSelected }, '⧉'),
      el('button', { title: f.hidden ? 'Show' : 'Hide', onclick: () => { f.hidden = !f.hidden; S.commit(); } }, f.hidden ? '◌' : '◉'),
      el('button', { title: f.locked ? 'Unlock (allow clicking on map)' : 'Lock (ignore clicks on map)', onclick: () => { f.locked = !f.locked; S.commit(); } }, f.locked ? '🔒' : '🔓'),
      el('button', { class: 'danger', title: 'Delete (Del)', onclick: deleteSelected }, '🗑')),
  );
  body.append(head);
  if (f.type === 'district' && f.followWall) body.append(el('p', { class: 'info' }, 'This district follows a wall’s shape. Edit the wall to reshape it, set “Shape follows” to its own outline, or split it into smaller districts with ✂.'));
  buildForm(body, SCHEMAS[f.type], f, {
    onInput: () => S.touch(),
    onCommit: () => S.commit('panel'),
    rebuild: () => renderPanel(),
    ctx: ctxHelpers,
    defaults: colorDefault,
  });
}

const TYPE_ICON = { wall: 'wall', district: 'district', cutout: 'cutout', farm: 'farm', water: 'water', river: 'river', road: 'road', plaza: 'plaza', building: 'building', landmark: 'landmark', label: 'label', compass: 'compass' };

function renderLayers(body) {
  const doc = S.getDoc();
  body.append(el('p', { class: 'info' }, 'Top of the list draws on top. Drag rows (or use ▲▼) to reorder — e.g. put a lake above a river. Roads, rivers, lakes, walls and buildings placed above a district cut through its blocks. Area and river names always stay on top.'));
  const list = el('div', { class: 'layers' });
  const order = [...doc.features].reverse();
  for (const f of order) {
    const name = (f.name || f.text || S.TYPE_LABELS[f.type]).split('\n')[0];
    const move = (dir) => {
      const arr = doc.features, i = arr.indexOf(f), j = i + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      S.commit();
    };
    const icon = el('span', { class: 'licon', title: S.TYPE_LABELS[f.type] });
    icon.innerHTML = `<svg viewBox="0 0 24 24">${ICON[TYPE_ICON[f.type]] || ''}</svg>`;
    const row = el('div', { class: 'layer' + (f.id === app.sel ? ' sel' : '') + (f.hidden ? ' hidden' : '') },
      el('span', { class: 'grip', title: 'Drag to reorder' }, '⠿'), icon,
      el('span', { class: 'lname', title: name }, name),
      el('button', { title: 'Move up (draw above)', onclick: (e) => { e.stopPropagation(); move(1); } }, '▲'),
      el('button', { title: 'Move down (draw below)', onclick: (e) => { e.stopPropagation(); move(-1); } }, '▼'),
      el('button', { title: f.hidden ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); f.hidden = !f.hidden; S.commit(); } }, f.hidden ? '◌' : '◉'),
      el('button', { title: f.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); f.locked = !f.locked; S.commit(); } }, f.locked ? '🔒' : '🔓'));
    row.dataset.id = f.id;
    row.addEventListener('click', () => { if (row.dataset.dragged) return; app.sel = f.id; renderPanel(); requestRender(); });
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const startY = e.clientY;
      let drop = null, active = false;
      const clear = () => list.querySelectorAll('.drop-above,.drop-below').forEach((r) => r.classList.remove('drop-above', 'drop-below'));
      const move = (ev) => {
        if (!active && Math.abs(ev.clientY - startY) < 5) return;
        if (!active) { active = true; row.classList.add('dragging'); }
        clear();
        const tgt = [...list.children].find((r) => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
        if (!tgt || tgt === row) { drop = null; return; }
        const b = tgt.getBoundingClientRect(), above = ev.clientY < b.top + b.height / 2;
        tgt.classList.add(above ? 'drop-above' : 'drop-below');
        drop = { id: tgt.dataset.id, above };
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        row.classList.remove('dragging');
        clear();
        if (!active) return;
        row.dataset.dragged = '1';
        setTimeout(() => { delete row.dataset.dragged; }, 0);
        if (!drop) return;
        const arr = doc.features, tgtF = arr.find((x) => x.id === drop.id);
        arr.splice(arr.indexOf(f), 1);
        // The list is shown top-first, so "above" in the list means later in the array.
        arr.splice(arr.indexOf(tgtF) + (drop.above ? 1 : 0), 0, f);
        S.commit();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    list.append(row);
  }
  body.append(list);
  if (!doc.features.length) body.append(el('p', { class: 'info' }, 'Nothing here yet — pick a tool on the left and start drawing.'));
}

function renderMapSettings(body) {
  const doc = S.getDoc();
  const h = { onInput: () => S.touch(), onCommit: () => S.commit('panel'), rebuild: () => renderPanel(), defaults: colorDefault };
  body.append(el('div', { class: 'heading' }, 'Map'));
  buildForm(body, [
    { k: 'title', label: 'File name', t: 'text' },
    { k: 'width', label: 'Page width', t: 'number', min: 300, max: 10000, step: 10 },
    { k: 'height', label: 'Page height', t: 'number', min: 300, max: 10000, step: 10 },
  ], doc.meta, h);
  const fontOpts = FONTS.map((f) => [f, f]);
  buildForm(body, [
    { k: 'theme', label: 'Theme', t: 'select', options: Object.entries(THEMES).map(([k, v]) => [k, v.name]), rebuild: true, onChange: (s) => { s.colors = {}; } },
    { k: 'fontLabel', label: 'Label font', t: 'select', options: fontOpts },
    { k: 'fontTitle', label: 'Title font', t: 'select', options: fontOpts },
    { k: 'fontScript', label: 'Script font', t: 'select', options: fontOpts },
    { t: 'heading', label: 'Decoration' },
    { k: 'frame', label: 'Border', t: 'check' },
    { k: 'frameStyle', label: 'Border style', t: 'select', options: [['solid', 'Solid'], ['ornate', 'Ornate (ladder)']] },
    { k: 'frameWidth', label: 'Border width', t: 'range', min: 4, max: 120, step: 1 },
    { k: 'haloWidth', label: 'Label halo', t: 'range', min: 0, max: 0.8, step: 0.01 },
    { k: 'featureGap', label: 'Gap at rivers & walls', t: 'range', min: 0, max: 20, step: 0.5 },
    { k: 'fields', label: 'Countryside fields', t: 'check' },
    { k: 'fieldSize', label: 'Field size', t: 'range', min: 40, max: 600, step: 5 },
    { k: 'seed', label: 'Fields seed', t: 'seed' },
    { k: 'hatch', label: 'Block hatching', t: 'check' },
    { k: 'hatchSpacing', label: 'Hatch spacing', t: 'range', min: 1.5, max: 12, step: 0.1 },
    { k: 'outline', label: 'Outline weight', t: 'range', min: 0, max: 4, step: 0.1 },
    { k: 'glow', label: 'District glow', t: 'check' },
    { k: 'glowSize', label: 'Glow size', t: 'range', min: 5, max: 150, step: 1 },
  ], doc.settings, h);
  body.append(el('div', { class: 'heading' }, 'Colors'),
    el('p', { class: 'info' }, '× resets a color to the theme default.'));
  buildForm(body, COLOR_KEYS.map(([k, l]) => ({ k, label: l, t: 'color' })), doc.settings.colors, h);

  body.append(el('div', { class: 'heading' }, 'Tracing image'),
    el('p', { class: 'info' }, 'Load a sketch or reference map to trace over. It is shown only in the editor, never exported, and stays in this browser only.'));
  const row = el('div', { class: 'btnrow' },
    el('button', { onclick: () => $('#fileRef').click() }, ref.img ? 'Replace image…' : 'Load image…'));
  if (ref.img) row.append(el('button', { onclick: () => { ref.img = null; ref.src = null; saveRef(); renderPanel(); requestRender(); } }, 'Remove'));
  body.append(row);
  if (ref.img) {
    buildForm(body, [
      { k: 'visible', label: 'Visible', t: 'check' },
      { k: 'opacity', label: 'Opacity', t: 'range', min: 0.05, max: 1, step: 0.05 },
      { k: 'scale', label: 'Scale', t: 'range', min: 0.05, max: 10, step: 0.01 },
      { k: 'x', label: 'Offset X', t: 'number', step: 10 },
      { k: 'y', label: 'Offset Y', t: 'number', step: 10 },
    ], ref, { onInput: requestRender, onCommit: () => { saveRef(); requestRender(); }, rebuild: renderPanel });
  }
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { app.tab = b.dataset.tab; renderPanel(); }));

// ---------- files ----------
const slug = () => (S.getDoc().meta.title || 'city').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'city';
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function saveJSON() { download(new Blob([JSON.stringify(S.getDoc(), null, 1)], { type: 'application/json' }), slug() + '.city.json'); }

function exportPNG() {
  const doc = S.getDoc(), k = parseFloat($('#exportScale').value) || 2;
  const c = document.createElement('canvas');
  c.width = Math.round(doc.meta.width * k); c.height = Math.round(doc.meta.height * k);
  const g = c.getContext('2d');
  renderMap(g, doc, { s: k, ox: 0, oy: 0, dpr: 1 });
  releaseLayers();
  c.toBlob((b) => (b ? download(b, slug() + '.png') : toast('Image too large for this browser — try a smaller scale.')), 'image/png');
}

$('#fileOpen').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.features)) throw new Error('not a city file');
    app.sel = null; S.setDoc(d); fitView();
  } catch (err) { toast('Could not open that file: ' + err.message); }
});

$('#fileRef').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    loadRefImage(r.result, () => {
      const d = S.getDoc();
      ref.scale = Math.min(d.meta.width / ref.img.width, d.meta.height / ref.img.height);
      ref.x = (d.meta.width - ref.img.width * ref.scale) / 2; ref.y = (d.meta.height - ref.img.height * ref.scale) / 2;
      ref.visible = true;
      saveRef(); renderPanel(); requestRender();
    });
  };
  r.readAsDataURL(file);
});

function loadRefImage(src, done) {
  const img = new Image();
  img.onload = () => { ref.img = img; ref.src = src; done && done(); requestRender(); };
  img.src = src;
}
function saveRef() {
  try {
    if (!ref.src) localStorage.removeItem('citybuilder.ref');
    else localStorage.setItem('citybuilder.ref', JSON.stringify({ src: ref.src, opacity: ref.opacity, visible: ref.visible, x: ref.x, y: ref.y, scale: ref.scale }));
  } catch (e) { toast('Tracing image is too large to remember between visits, but it works for this session.'); }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function toggleHelp(show) { $('#help').classList.toggle('hidden', !show); }

// ---------- top bar ----------
// Swap in a whole new map as one undoable step (Ctrl+Z brings the old one back).
function replaceDoc(next) {
  app.sel = null;
  const d = S.getDoc();
  d.features = next.features; d.meta = next.meta; d.settings = next.settings;
  S.commit();
  fitView();
}
$('#btnNewRandom').addEventListener('click', () => {
  if (!confirm('Replace the current map with a new random city? (Ctrl+Z undoes this.)')) return;
  replaceDoc(randomCity(Math.floor(Math.random() * 1e9)));
});
$('#btnNewBlank').addEventListener('click', () => {
  if (!confirm('Start a blank map? (Ctrl+Z undoes this.)')) return;
  replaceDoc(S.blankDoc());
});
$('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
$('#btnSave').addEventListener('click', saveJSON);
$('#btnExport').addEventListener('click', exportPNG);
$('#btnUndo').addEventListener('click', () => S.undo());
$('#btnRedo').addEventListener('click', () => S.redo());
$('#btnFit').addEventListener('click', fitView);
$('#btnHelp').addEventListener('click', () => toggleHelp(true));
$('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) toggleHelp(false); });

function updateStatus() {
  const t = toolById(app.tool);
  $('#stCoords').textContent = app.mouse ? `${Math.round(app.mouse[0])}, ${Math.round(app.mouse[1])}` : '';
  $('#stZoom').textContent = Math.round(view.s * 100) + '%';
  $('#stHint').textContent = app.drawing ? t.hint + ' · Backspace removes last point · Esc cancels' : t.hint;
  $('#btnUndo').disabled = !S.canUndo();
  $('#btnRedo').disabled = !S.canRedo();
}

// ---------- boot ----------
S.onChange((kind, source) => {
  if (kind === 'doc') {
    if (app.sel && !S.byId(app.sel)) app.sel = null;
    if (!(source === 'panel' && app.tab !== 'layers')) renderPanel();
  }
  requestRender();
});

new ResizeObserver(resize).observe($('#stage'));
renderTools();
const saved = S.loadSaved();
S.setDoc(saved && Array.isArray(saved.features) ? saved : randomCity(Math.floor(Math.random() * 1e9)));
try {
  const r = JSON.parse(localStorage.getItem('citybuilder.ref') || 'null');
  if (r && r.src) { Object.assign(ref, r, { img: null }); loadRefImage(r.src); }
} catch (e) { /* ignore */ }
resize();
fitView();
setTool('select');
renderPanel();
if (document.fonts) {
  for (const f of FONTS) document.fonts.load(`600 20px "${f}"`).catch(() => {});
  document.fonts.ready.then(requestRender);
  document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', requestRender);
}
