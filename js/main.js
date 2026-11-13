// Editor: tools, mouse/keyboard interaction, panels, file I/O.

import * as S from './state.js';
import * as G from './geom.js';
import { renderMap, releaseLayers, plazaCorners, featureShape, isClosed, isPointType, getColors, findWalls } from './render.js';
import { SCHEMAS, buildForm, collapsible, el } from './ui.js';
import * as CG from './citygen.js';
import { shapePoints } from './shapes.js';
import { THEMES, COLOR_KEYS, FONTS } from './themes.js';
import * as SN from './snap.js';
import { KITS, defaultKitState } from './kits.js';
import { makeRng } from './rng.js';
import { PRESETS } from './generate.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#map');
const ctx = canvas.getContext('2d');
const view = { s: 0.3, ox: 0, oy: 0 };
let dpr = window.devicePixelRatio || 1;

// `sel` is the primary selected feature; `selSet` holds every selected feature (shift-click, box-select, groups).
// Assigning `app.sel = id` selects just that one.
const app = {
  tool: 'select', _sel: null, selSet: new Set(), drawing: null, drag: null, hover: null, snap: null, guides: { gx: null, gy: null },
  hits: [], space: false, mouse: null, tab: 'props', marquee: null, kit: null, kitState: defaultKitState(),
  genOutline: null, exportScale: 2,
  gen: { districts: 6, gates: 6, walled: true, river: 'through', ring: true, farmland: true, density: 'edge', halls: 6, splitMode: 'center', size: 650, seed: Math.floor(Math.random() * 1e9), clear: true },
  split: { n: 5, mode: 'center', vary: true },
};
Object.defineProperty(app, 'sel', {
  get() { return this._sel; },
  set(v) { this._sel = v || null; this.selSet = new Set(v ? [v] : []); },
});
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
  streetName: '<path d="M3 18c5-9 11-9 18-3"/><path d="M8 12.5l.8 3M12 11.5l.4 3M16 12.5l-.4 3"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M12 4l2.5 8-2.5 8-2.5-8z"/>',
  split: '<path d="M4 6l9-3 7 6-3 11-11-2z" opacity=".5"/><path d="M3 20L21 4" stroke-dasharray="3 2"/>',
  cutout: '<path d="M4 6l9-3 7 6-3 11-11-2z" opacity=".5"/><circle cx="12" cy="12" r="3.5" stroke-dasharray="2.5 2"/>',
  docks: '<path d="M3 9h18v3H3z"/><path d="M5.5 12v8M10 12v8M14 12v8M18.5 12v8"/>',
  buildingShape: '<path d="M12 3l2.2 5.3 5.6.4-4.3 3.7 1.4 5.5L12 15l-4.9 2.9 1.4-5.5-4.3-3.7 5.6-.4z"/>',
  farm: '<path d="M3 6h18v13H3z"/><path d="M3 12h18M11 6v13"/><path d="M5 8.5h4M5 10h4M13 14h6M13 16.5h6" opacity=".6"/>',
};

const TOOLS = [
  { id: 'select', key: 'v', label: 'Select & move', hint: 'Click to select · Shift-click to add or remove · Shift-drag to box-select · drag to move · drag empty space to pan · double-click an edge to add a point · right-click a point to delete it · Alt-click to cycle overlapping items' },
  { id: 'wall', key: 'w', type: 'wall', draw: 'poly', label: 'City wall', hint: 'Click to place wall corners · drag to sketch freehand · click the first point, double-click or Enter to close' },
  { id: 'district', key: 'd', type: 'district', draw: 'poly', label: 'District', hint: 'Outline a district; streets are generated inside it. Click the first point or double-click to finish' },
  { id: 'split', key: 'k', draw: 'line', label: 'Split district', hint: 'Draw a line across a district or farmland to break it in two (only the selected one, if any) · double-click / Enter to cut' },
  { id: 'cutout', key: 'x', type: 'cutout', draw: 'poly', label: 'Cut away', hint: 'Outline an area to cut out of the districts below it (a hole, bay or notch inside a district) · double-click to finish' },
  { id: 'farm', key: 'g', type: 'farm', draw: 'poly', label: 'Farmland', hint: 'Outline farmland; it fills with fields, furrows and hedgerows · double-click to finish' },
  { id: 'water', key: 'a', type: 'water', draw: 'poly', label: 'Lake / sea / bay', hint: 'Outline a body of water (drag to sketch a coastline) · double-click to finish' },
  { id: 'river', key: 'f', type: 'river', draw: 'line', label: 'River', hint: 'Click points along the river (or drag freehand) · double-click / Enter to finish' },
  { id: 'canal', key: 'n', type: 'river', draw: 'line', label: 'Canal', extra: { canal: true, width: 15, name: '', showLabel: false, smooth: false }, hint: 'Click points along the canal · double-click to finish' },
  { id: 'road', key: 'r', type: 'road', draw: 'line', label: 'Avenue', extra: { kind: 'avenue', width: 13 }, hint: 'Click points along the avenue; it snaps to other points and edges (hold Alt to not snap, Shift for 15° steps) · double-click to finish' },
  { id: 'street', key: 's', type: 'road', draw: 'line', label: 'Street', extra: { kind: 'street', width: 6, ruralOutside: false }, hint: 'Draw a hand-placed street · double-click to finish' },
  { id: 'rural', key: 'u', type: 'road', draw: 'line', label: 'Country road', extra: { kind: 'rural', width: 6 }, hint: 'Thin road through the countryside · double-click to finish' },
  { id: 'plaza', key: 'p', type: 'plaza', draw: 'point', label: 'Round plaza', hint: 'Click to place a round plaza' },
  { id: 'plazaSq', key: 'q', type: 'plaza', draw: 'point', label: 'Square plaza', extra: { shape: 'square', radius: 28, monument: 'none' }, hint: 'Click to place a square plaza; set rotation and proportions in the panel' },
  { id: 'building', key: 'b', type: 'building', draw: 'poly', label: 'Building / keep', hint: 'Outline a large building, keep or monument · double-click to finish' },
  { id: 'buildingShape', key: 'j', type: 'building', draw: 'point', label: 'Building shape (star, square, round…)', extra: { shape: 'star8', size: 28, style: 'solid' }, hint: 'Click to place a preset building shape; change the shape, size and look in the panel' },
  { id: 'docks', key: 'o', type: 'building', draw: 'point', label: 'Docks / pier', extra: { shape: 'dockComb', size: 70, aspect: 1, fingers: 5, style: 'district', tone: 'normal', hatch: true, blend: true, gap: 0, name: 'Docks' }, hint: 'Click to place docks (a quay with piers); put them over water. Rotate, resize and change the number of piers in the panel; choose the pier / jetty shape for a single jetty' },
  { id: 'landmark', key: 'l', type: 'landmark', draw: 'point', label: 'Landmark', hint: 'Click to place a labelled landmark dot' },
  { id: 'label', key: 't', type: 'label', draw: 'point', label: 'Text label', hint: 'Click to place a label, then type its text in the panel' },
  { id: 'streetName', key: 'y', type: 'label', draw: 'point', label: 'Street name', hint: 'Click on a road to add a street name that runs along it (drag it to slide it along the road)' },
  { id: 'compass', key: 'c', type: 'compass', draw: 'point', label: 'Compass rose', hint: 'Click to place a compass rose' },
  { id: 'kit', hidden: true, draw: 'point', label: 'Place kit', hint: 'Click where the kit should go · Esc cancels' },
  { id: 'outline', hidden: true, draw: 'poly', label: 'Draw city outline', hint: 'Sketch the outline of your city (drag to draw freehand, or click corners) · double-click or Enter to finish · Esc cancels' },
];
const toolById = (id) => TOOLS.find((t) => t.id === id);

// The toolbar shows one button per group; the arrow (or right-click) opens the rest of the group.
const TOOL_GROUPS = [
  { id: 'select', label: 'Select', tools: ['select'] },
  { id: 'areas', label: 'Areas', tools: ['district', 'farm', 'water', 'cutout'] },
  { id: 'lines', label: 'Lines & walls', tools: ['wall', 'river', 'canal', 'road', 'street', 'rural'] },
  { id: 'places', label: 'Places', tools: ['plaza', 'plazaSq', 'building', 'buildingShape', 'docks', 'landmark'] },
  { id: 'text', label: 'Text & compass', tools: ['label', 'streetName', 'compass'] },
  { id: 'edit', label: 'Edit areas', tools: ['split'] },
];
for (const g of TOOL_GROUPS) g.current = g.tools[0];
const groupOf = (toolId) => TOOL_GROUPS.find((g) => g.tools.includes(toolId));

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

// ---------- selection helpers ----------
const selIds = () => [...app.selSet];
const selFeats = () => selIds().map((id) => S.byId(id)).filter(Boolean);

function pruneSel() {
  for (const id of [...app.selSet]) if (!S.byId(id)) app.selSet.delete(id);
  if (app._sel && !S.byId(app._sel)) app._sel = [...app.selSet].pop() || null;
}

function setMulti(ids, primary) {
  const list = ids.filter((id) => S.byId(id));
  app.selSet = new Set(list);
  app._sel = primary && app.selSet.has(primary) ? primary : list[list.length - 1] || null;
  if (list.length && app.tab !== 'layers') app.tab = 'props';
  renderPanel();
  requestRender();
}

function select(id) {
  app.sel = id;
  if (id && app.tab !== 'layers') app.tab = 'props';
  renderPanel();
  requestRender();
}

function toggleSelect(id) {
  const ids = selIds();
  const i = ids.indexOf(id);
  if (i >= 0) ids.splice(i, 1); else ids.push(id);
  setMulti(ids, i >= 0 ? null : id);
}

const groupMembers = (gid) => S.getDoc().features.filter((f) => f.groupId === gid).map((f) => f.id);
const movable = (f) => f.points.length > 0 && !(f.type === 'label' && f.pathId) && !(f.type === 'district' && f.followWall);

function moveFeature(f, dx, dy) {
  if (movable(f)) f.points = f.points.map((p) => [p[0] + dx, p[1] + dy]);
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

function drawGrid() {
  if (!SN.snap.showGrid || SN.snap.gridSize <= 0) return;
  const doc = S.getDoc();
  let step = SN.snap.gridSize;
  while (step * view.s < 8) step *= 2;
  const x0 = view.ox, y0 = view.oy, x1 = view.ox + doc.meta.width * view.s, y1 = view.oy + doc.meta.height * view.s;
  ctx.beginPath();
  for (let x = 0; x <= doc.meta.width; x += step) { const sx = view.ox + x * view.s; ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); }
  for (let y = 0; y <= doc.meta.height; y += step) { const sy = view.oy + y * view.s; ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); }
  ctx.strokeStyle = 'rgba(80,170,255,.22)'; ctx.lineWidth = 1; ctx.stroke();
}

function drawOverlay() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGrid();
  if (app.genOutline) {
    strokeScreen(app.genOutline, true, 'rgba(0,0,0,.55)', 5);
    strokeScreen(app.genOutline, true, '#ffb547', 2.5, [10, 6]);
    ctx.fillStyle = 'rgba(255,181,71,.08)';
    ctx.beginPath(); app.genOutline.forEach((p, i) => { const q = toScreen(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fill();
  }
  const hov = app.hover && !app.selSet.has(app.hover) ? S.byId(app.hover) : null;
  if (hov && app.tool === 'select' && !app.drag) strokeScreen(outlineOf(hov), closedOutline(hov), 'rgba(80,170,255,.55)', 2);
  const multi = app.selSet.size > 1;
  for (const f of selFeats()) {
    const o = outlineOf(f);
    strokeScreen(o, closedOutline(f), 'rgba(0,0,0,.5)', 4);
    strokeScreen(o, closedOutline(f), multi ? '#ffb547' : '#4db0ff', 2, [6, 4]);
    if (multi) continue;
    const pts = editablePoints(f);
    if (pts) {
      if (f.smooth) strokeScreen(pts, isClosed(f), 'rgba(77,176,255,.45)', 1);
      for (const p of pts) {
        const q = toScreen(p);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a6fd1'; ctx.lineWidth = 1.5;
        ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8); ctx.strokeRect(q[0] - 4, q[1] - 4, 8, 8);
      }
      // Round "add a node" handles at the middle of each segment: drag one to insert and move a node in one go.
      for (const h of midHandles(f)) {
        const q = toScreen(h.p);
        ctx.beginPath(); ctx.arc(q[0], q[1], 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fill();
        ctx.strokeStyle = '#1a6fd1'; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(q[0] - 2, q[1]); ctx.lineTo(q[0] + 2, q[1]); ctx.moveTo(q[0], q[1] - 2); ctx.lineTo(q[0], q[1] + 2);
        ctx.strokeStyle = '#1a6fd1'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  if (app.drawing) {
    const t = toolById(app.drawing.tool);
    const pts = app.drawing.pts.concat(app.mouse ? [app.snapped || app.mouse] : []);
    strokeScreen(pts, false, 'rgba(0,0,0,.6)', 4);
    strokeScreen(pts, false, '#ffb547', 2);
    if (t.draw === 'poly' && pts.length > 2) strokeScreen([pts[pts.length - 1], pts[0]], false, '#ffb547', 1.5, [5, 5]);
    for (const p of app.drawing.pts) {
      const q = toScreen(p);
      ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = '#ffb547'; ctx.fill();
    }
  }
  // Alignment guides
  const { gx, gy } = app.guides;
  if (gx != null || gy != null) {
    ctx.save();
    ctx.strokeStyle = '#ff5fd2'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (gx != null) { const sx = toScreen([gx, 0])[0]; ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height / dpr); }
    if (gy != null) { const sy = toScreen([0, gy])[1]; ctx.moveTo(0, sy); ctx.lineTo(canvas.width / dpr, sy); }
    ctx.stroke();
    ctx.restore();
  }
  if (app.snap) {
    const q = toScreen(app.snap);
    ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#59e38b'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (app.marquee) {
    const a = toScreen(app.marquee.a), b = toScreen(app.marquee.b);
    ctx.fillStyle = 'rgba(77,176,255,.12)'; ctx.strokeStyle = '#4db0ff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.setLineDash([]);
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

// ---------- adding nodes to lines ----------
function midHandles(f) {
  const pts = editablePoints(f);
  if (!pts || pts.length < 2) return [];
  const closed = isClosed(f), segs = closed ? pts.length : pts.length - 1, out = [];
  for (let i = 0; i < segs; i++) {
    const a = toScreen(pts[i]), b = toScreen(pts[(i + 1) % pts.length]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 26) continue;   // too short to need one
    out.push({ i, p: G.segmentMid(pts, i, closed, !!f.smooth) });
  }
  return out;
}

function midHandleAt(sx, sy) {
  if (app.selSet.size !== 1) return null;
  const f = app.sel && S.byId(app.sel);
  if (!f) return null;
  for (const h of midHandles(f)) { const q = toScreen(h.p); if (Math.hypot(q[0] - sx, q[1] - sy) < 7) return h; }
  return null;
}

function nearestOnFeature(f, w) {
  const pts = editablePoints(f);
  if (!pts || pts.length < 2) return null;
  const closed = isClosed(f);
  return f.smooth && pts.length >= 3 ? G.nearestOnSpline(pts, w, closed) : G.nearestOnPath(w, pts, closed);
}

// Insert a node after control point i and return its index.
function insertNode(f, i, p) {
  f.points.splice(i + 1, 0, [p[0], p[1]]);
  return i + 1;
}

function handleAt(sx, sy) {
  if (app.selSet.size > 1) return -1;
  const f = app.sel && S.byId(app.sel);
  const pts = editablePoints(f);
  if (!pts) return -1;
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = toScreen(pts[i]);
    if (Math.abs(q[0] - sx) < 7 && Math.abs(q[1] - sy) < 7) return i;
  }
  return -1;
}

// ---------- snapping ----------
function snapPoint(w, disabled, skipId, from, shift) {
  const r = SN.snapPoint(w, {
    feats: S.getDoc().features, tol: 9 / view.s, skip: new Set(skipId ? (Array.isArray(skipId) ? skipId : [skipId]) : []),
    from, shift, disabled,
  });
  app.snap = r.marker; app.snapped = r.p; app.guides = { gx: r.gx, gy: r.gy };
  return r.p;
}
const clearSnap = () => { app.snap = null; app.snapped = null; app.guides = { gx: null, gy: null }; };

// ---------- tools & editing ----------
function setTool(id) {
  if (app.drawing) finishDrawing();
  app.tool = id;
  if (id !== 'split') app.splitTarget = null;
  if (id !== 'kit') app.kit = null;
  const grp = groupOf(id);
  if (grp) grp.current = id;
  syncToolbar();
  canvas.style.cursor = id === 'select' ? 'default' : 'crosshair';
  if (!app.sel) renderPanel();
  updateStatus();
}

function finishDrawing() {
  const d = app.drawing;
  app.drawing = null; clearSnap();
  if (!d) return;
  const t = toolById(d.tool);
  const pts = [];
  for (const p of d.pts) if (!pts.length || G.dist(pts[pts.length - 1], p) > 3 / view.s) pts.push(p);
  if (t.draw === 'poly' && pts.length > 3 && G.dist(pts[0], pts[pts.length - 1]) < 3 / view.s) pts.pop();
  const min = t.draw === 'poly' ? 3 : 2;
  if (pts.length < min) { requestRender(); return; }
  if (t.id === 'split') { splitAreas(pts, d.target); return; }
  if (t.id === 'outline') { setGenOutline(pts); return; }
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

// A street name: attaches to the road under the click and runs along its curve.
function placeStreetName(w) {
  const doc = S.getDoc(), tol = 40 / view.s;
  let best = null, bd = tol;
  for (const f of doc.features) {
    if (f.type !== 'road' || f.hidden) continue;
    const sh = featureShape(f, doc);
    if (sh.length < 2) continue;
    const r = G.nearestOnPath(w, sh, isClosed(f)), d = r.d - f.width / 2;
    if (d < bd) { bd = d; best = { f, sh, r }; }
  }
  const lab = S.createFeature('label', [w], { text: 'Street Name', style: 'street', size: best ? Math.max(9, Math.min(20, best.f.width * 0.9)) : 13, spacing: 0.18 });
  if (best) {
    const cum = G.cumLengths(best.sh);
    lab.pathId = best.f.id;
    lab.pathPos = Math.max(0, Math.min(1, (cum[best.r.i] + G.dist(best.sh[best.r.i], best.r.q)) / cum[cum.length - 1]));
  } else toast('No road under the click, so this is a free label. Click directly on a road to attach a street name to it.');
  S.insertFeature(lab);
  app.sel = lab.id; app.tab = 'props';
  S.commit();
  setTimeout(() => { const ta = document.querySelector('#panelBody textarea'); if (ta) { ta.focus(); ta.select(); } }, 0);
}

function placePoint(t, w) {
  if (t.id === 'streetName') { placeStreetName(w); return; }
  const f = S.createFeature(t.type, [w], t.extra || {});
  if (t.type === 'label') f.text = 'New Label';
  if (t.type === 'building') f.points = shapePoints(f.shape, w, f.size, f.angle, f.aspect, f.inner, f.fingers) || [w];
  S.insertFeature(f);
  app.sel = f.id;
  app.tab = 'props';
  S.commit();
  if (t.type === 'label') setTimeout(() => { const ta = document.querySelector('#panelBody textarea'); if (ta) { ta.focus(); ta.select(); } }, 0);
}

function placeKit(kit, params, center) {
  const doc = S.getDoc();
  const gid = 'g' + S.newId();
  const ids = [];
  let prev = null;
  for (const f of kit.build(center, params)) {
    f.groupId = gid; f.groupName = kit.name;
    if (f.afterPrev && prev) { delete f.afterPrev; doc.features.splice(doc.features.indexOf(prev) + 1, 0, f); }
    else { delete f.afterPrev; S.insertFeature(f); }
    prev = f; ids.push(f.id);
  }
  setTool('select');
  setMulti(ids);
  S.commit();
  toast(`${kit.name} placed: ${ids.length} items, selected together. Drag to move them as one, or re-roll the kit's seed and place again.`);
}

function deleteSelected() {
  if (!app.selSet.size) return;
  const doc = S.getDoc(), gone = new Set(app.selSet);
  doc.features = doc.features.filter((f) => !gone.has(f.id));
  app.sel = null;
  S.commit();
}

function duplicateSelected() {
  const fs = selFeats();
  if (!fs.length) return;
  const doc = S.getDoc(), groupMap = new Map(), made = [];
  for (const f of fs) {
    const c = JSON.parse(JSON.stringify(f));
    c.id = S.newId();
    c.points = c.points.map((p) => [p[0] + 30, p[1] + 30]);
    if (c.type === 'district' || c.type === 'farm') { c.seed = Math.floor(Math.random() * 1e9); c.locked = false; }
    if (c.groupId) { if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, 'g' + S.newId()); c.groupId = groupMap.get(c.groupId); }
    doc.features.splice(doc.features.indexOf(f) + 1, 0, c);
    made.push(c.id);
  }
  setMulti(made);
  S.commit();
}

// Align / distribute the selected features by their bounding boxes.
function alignSel(mode) {
  const items = selFeats().filter(movable).map((f) => ({ f, b: G.bbox(outlineOf(f)) }));
  if (items.length < 2) return;
  const x0 = Math.min(...items.map((i) => i.b.x0)), x1 = Math.max(...items.map((i) => i.b.x1));
  const y0 = Math.min(...items.map((i) => i.b.y0)), y1 = Math.max(...items.map((i) => i.b.y1));
  for (const { f, b } of items) {
    let dx = 0, dy = 0;
    if (mode === 'left') dx = x0 - b.x0;
    else if (mode === 'right') dx = x1 - b.x1;
    else if (mode === 'hcenter') dx = (x0 + x1) / 2 - (b.x0 + b.x1) / 2;
    else if (mode === 'top') dy = y0 - b.y0;
    else if (mode === 'bottom') dy = y1 - b.y1;
    else if (mode === 'vcenter') dy = (y0 + y1) / 2 - (b.y0 + b.y1) / 2;
    moveFeature(f, dx, dy);
  }
  S.commit();
}

function distributeSel(axis) {
  const items = selFeats().filter(movable).map((f) => ({ f, b: G.bbox(outlineOf(f)) }));
  if (items.length < 3) { toast('Select at least three items to distribute.'); return; }
  const c = (i) => (axis === 'h' ? (i.b.x0 + i.b.x1) / 2 : (i.b.y0 + i.b.y1) / 2);
  items.sort((a, b) => c(a) - c(b));
  const first = c(items[0]), last = c(items[items.length - 1]);
  items.forEach((it, i) => {
    const d = first + ((last - first) * i) / (items.length - 1) - c(it);
    moveFeature(it.f, axis === 'h' ? d : 0, axis === 'h' ? 0 : d);
  });
  S.commit();
}

const ctxHelpers = {
  haloDefault() { return S.getDoc().settings.haloWidth ?? 0.34; },
  detachLabel(f) { f.pathId = ''; S.commit(); },
  autoSplitUI(target, f) { buildAutoSplit(target, f); },
  gapDefault() { return S.getDoc().settings.featureGap ?? 4; },
  // Rebuild a preset-shaped building around its current centre.
  reshapeBuilding(f) {
    if (f.shape === 'free' || !f.points.length) return;
    const c = f.points.length >= 3 ? G.centroid(f.points) : f.points[0];
    const pts = shapePoints(f.shape, c, f.size, f.angle, f.aspect, f.inner, f.fingers);
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

// Features whose control points fall inside a world-space rectangle (box select).
function featuresInRect(a, b) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const doc = S.getDoc(), out = [];
  for (const f of doc.features) {
    if (f.hidden || f.locked) continue;
    const pts = f.type === 'district' && f.followWall ? (S.byId(f.followWall) || {}).points || [] : f.points;
    if (pts.some((p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1)) out.push(f.id);
  }
  return out;
}

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

  if (tool.id === 'kit') {
    if (app.kit) placeKit(app.kit.def, app.kit.params, snapPoint(w, e.altKey));
    clearSnap();
    return;
  }
  if (tool.draw === 'point') { placePoint(tool, snapPoint(w, e.altKey)); clearSnap(); return; }
  if (tool.draw) {
    const last = app.drawing && app.drawing.pts[app.drawing.pts.length - 1];
    const p = snapPoint(w, e.altKey, null, last, e.shiftKey);
    if (!app.drawing) {
      const sel = app.sel && S.byId(app.sel);
      const target = tool.id === 'split' ? app.splitTarget || (sel && (sel.type === 'district' || sel.type === 'farm') ? sel.id : null) : null;
      app.drawing = { tool: tool.id, pts: [p], target };
    } else {
      const first = app.drawing.pts[0];
      if (tool.draw === 'poly' && app.drawing.pts.length >= 3 && G.dist(toScreen(first), [sx, sy]) < 10) { finishDrawing(); return; }
      app.drawing.pts.push(p);
    }
    app.drag = { mode: 'freehand', sx, sy, moved: false };
    requestRender();
    return;
  }

  // select tool
  const mh = midHandleAt(sx, sy);
  if (mh) {
    const f = S.byId(app.sel);
    app.drag = { mode: 'vertex', index: insertNode(f, mh.i, mh.p), id: f.id, moved: true };
    S.touch();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && app.selSet.size === 1) {
    // Ctrl-click on the selected line adds a node exactly there and lets you drag it.
    const f = S.byId(app.sel), r = f && nearestOnFeature(f, w);
    if (r && r.d * view.s < 14) {
      app.drag = { mode: 'vertex', index: insertNode(f, r.i, r.q), id: f.id, moved: true };
      S.touch();
      return;
    }
  }
  const hi = handleAt(sx, sy);
  if (hi >= 0) {
    app.drag = { mode: 'vertex', index: hi, id: app.sel, moved: false };
    return;
  }
  const hits = hitTest(w);
  if (!hits.length) {
    if (e.shiftKey) { app.marquee = { a: w, b: w, add: e.ctrlKey || e.metaKey }; app.drag = { mode: 'marquee' }; return; }
    if (app.selSet.size) select(null);
    app.drag = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy, button: 0 };
    canvas.style.cursor = 'grabbing';
    return;
  }
  let hit = hits[0];
  if (e.altKey) {
    const idx = hits.findIndex((h) => h.id === app.sel);
    if (idx >= 0) hit = hits[(idx + 1) % hits.length];
  }
  if (e.shiftKey) { toggleSelect(hit.id); return; }
  const inMulti = app.selSet.size > 1 && app.selSet.has(hit.id);
  if (!inMulti && hit.id !== app.sel) select(hit.id);
  const f = S.byId(hit.id);
  const mode = inMulti ? 'move' : hit.kind === 'offset' ? 'offset' : hit.kind === 'pathpos' ? 'pathpos' : 'move';
  const ids = mode === 'move' ? (inMulti ? selIds() : [f.id]) : [f.id];
  app.drag = {
    mode, id: f.id, start: w, moved: false, ids,
    origs: new Map(ids.map((id) => [id, JSON.parse(JSON.stringify(S.byId(id).points))])),
    orig: JSON.parse(JSON.stringify(f.points)), origOffset: (f.labelOffset || [0, 0]).slice(),
  };
});

canvas.addEventListener('pointermove', (e) => {
  const sx = e.offsetX, sy = e.offsetY, w = toWorld(sx, sy);
  app.mouse = w;
  const d = app.drag;
  if (!d) {
    if (app.drawing || app.tool === 'kit' || (toolById(app.tool) || {}).draw === 'point') {
      const last = app.drawing && app.drawing.pts[app.drawing.pts.length - 1];
      snapPoint(w, e.altKey, null, last, e.shiftKey);
    } else clearSnap();
    if (app.tool === 'select') {
      const hits = hitTest(w);
      app.hover = hits.length ? hits[0].id : null;
      canvas.style.cursor = midHandleAt(sx, sy) ? 'copy' : handleAt(sx, sy) >= 0 ? 'pointer' : hits.length ? 'move' : 'default';
    }
    requestRender();
    return;
  }
  if (d.mode === 'pan') {
    view.ox = d.ox + sx - d.sx; view.oy = d.oy + sy - d.sy;
    requestRender();
    return;
  }
  if (d.mode === 'marquee') { app.marquee.b = w; requestRender(); return; }
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
    const pts = f.points, i = d.index, from = pts.length > 1 ? pts[(i - 1 + pts.length) % pts.length] : null;
    pts[i] = snapPoint(w, e.altKey, f.id, from, e.shiftKey);
  } else if (d.mode === 'move') {
    const raw = [w[0] - d.start[0], w[1] - d.start[1]];
    const skip = new Set(d.ids);
    const movers = [];
    for (const id of d.ids) for (const p of d.origs.get(id) || []) movers.push(p);
    const r = e.altKey ? { d: raw, marker: null, gx: null, gy: null } : SN.snapMove(raw, movers, S.getDoc().features, skip, 9 / view.s);
    app.snap = r.marker; app.guides = { gx: r.gx, gy: r.gy };
    for (const id of d.ids) {
      const g = S.byId(id);
      if (g && movable(g)) g.points = d.origs.get(id).map((p) => [p[0] + r.d[0], p[1] + r.d[1]]);
    }
  } else if (d.mode === 'offset') {
    f.labelOffset = [d.origOffset[0] + w[0] - d.start[0], d.origOffset[1] + w[1] - d.start[1]];
  } else if (d.mode === 'pathpos') {
    // Slide a river name, or a street name attached to a road, along its path.
    const pf = f.type === 'label' ? S.byId(f.pathId) : f;
    if (pf) {
      const sh = featureShape(pf, S.getDoc());
      if (sh.length >= 2) {
        const r = G.nearestOnPath(w, sh, false), cum = G.cumLengths(sh);
        const v = Math.max(0, Math.min(1, (cum[r.i] + G.dist(sh[r.i], r.q)) / cum[cum.length - 1]));
        if (f.type === 'label') f.pathPos = v; else f.labelPos = v;
      }
    }
  }
  S.touch();
});

canvas.addEventListener('pointerup', () => {
  const d = app.drag;
  app.drag = null;
  if (!d) return;
  if (d.mode === 'pan') { canvas.style.cursor = app.tool === 'select' ? 'default' : 'crosshair'; return; }
  if (d.mode === 'marquee') {
    const m = app.marquee;
    app.marquee = null;
    const tiny = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) * view.s < 4;
    if (!tiny) setMulti([...(m.add ? selIds() : []), ...featuresInRect(m.a, m.b)]);
    requestRender();
    return;
  }
  if (d.mode === 'freehand') return;
  clearSnap();
  if (d.moved) S.commit(); else requestRender();
});

canvas.addEventListener('dblclick', (e) => {
  if (app.drawing) { finishDrawing(); return; }
  if (app.tool !== 'select') return;
  const w = toWorld(e.offsetX, e.offsetY);
  let f = app.selSet.size === 1 && app.sel && S.byId(app.sel);
  let r = f ? nearestOnFeature(f, w) : null;
  if (!f || !r || r.d * view.s > 25) {
    // Double-clicking any line or outline adds a node to it, selected or not.
    f = hitTest(w).map((h) => S.byId(h.id)).find((x) => x && editablePoints(x));
    r = f ? nearestOnFeature(f, w) : null;
    if (!f || !r || r.d * view.s > 25) return;
  }
  insertNode(f, r.i, r.q);
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
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setTool('select'); setMulti(S.getDoc().features.filter((f) => !f.hidden && !f.locked).map((f) => f.id)); return; }
  if (e.key === ' ') { app.space = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (!$('#popMenu').classList.contains('hidden')) { closeMenu(); return; }
    if (app.drawing) { app.drawing = null; clearSnap(); requestRender(); }
    else if (app.tool !== 'select') setTool('select');
    else select(null);
    return;
  }
  if (e.key === 'Enter' && app.drawing) { finishDrawing(); return; }
  if (e.key === 'Backspace' && app.drawing) { app.drawing.pts.pop(); if (!app.drawing.pts.length) app.drawing = null; requestRender(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.selSet.size) { deleteSelected(); return; }
  if (e.key === 'f' && e.shiftKey) { fitView(); return; }
  if (e.key === 'g' && e.shiftKey) { toggleSnap(); return; }
  if (mod || e.altKey) return;
  const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
  if (t) setTool(t.id);
  if (e.key === '?') toggleHelp(true);
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { app.space = false; canvas.style.cursor = app.tool === 'select' ? 'default' : 'crosshair'; } });

// ---------- panels ----------
function svgIcon(id) { return `<svg viewBox="0 0 24 24">${ICON[id] || ''}</svg>`; }

function renderTools() {
  const nav = $('#tools');
  nav.innerHTML = '';
  for (const g of TOOL_GROUPS) {
    const b = el('button', { class: 'tool', 'data-group': g.id });
    b.dataset.menuAnchor = '1';
    b.append(el('span', { class: 'ticon' }));
    if (g.tools.length > 1) {
      const caret = el('span', { class: 'caret', title: `More ${g.label.toLowerCase()} tools` });
      caret.addEventListener('click', (e) => { e.stopPropagation(); openToolFlyout(g, b); });
      b.append(caret);
    }
    b.addEventListener('click', () => setTool(g.current));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); if (g.tools.length > 1) openToolFlyout(g, b); });
    nav.append(b);
    if (g.id === 'select') nav.append(el('div', { class: 'sep' }));
  }
  syncToolbar();
}

// Show each group's current tool and highlight the group that holds the active tool.
function syncToolbar() {
  document.querySelectorAll('#tools .tool').forEach((b) => {
    const g = TOOL_GROUPS.find((x) => x.id === b.dataset.group), t = toolById(g.current);
    b.classList.toggle('active', g.tools.includes(app.tool));
    b.querySelector('.ticon').innerHTML = svgIcon(g.current);
    b.title = `${t.label} (${t.key.toUpperCase()})` + (g.tools.length > 1 ? ' — use the corner arrow or right-click for the rest of this group' : '');
  });
}

function openToolFlyout(g, anchor) {
  const r = anchor.getBoundingClientRect();
  showMenu({ x: r.right + 6, y: r.top }, g.tools.map((id) => {
    const t = toolById(id);
    return { icon: id, label: t.label, hint: t.key.toUpperCase(), active: app.tool === id, onClick: () => setTool(id) };
  }), 'tools-' + g.id);
}

// A small popup menu used by the File menu and the tool groups.
let menuOwner = null;
function showMenu(pos, items, owner) {
  const m = $('#popMenu');
  if (!m.classList.contains('hidden') && owner && menuOwner === owner) { closeMenu(); return; }
  menuOwner = owner || null;
  m.innerHTML = '';
  for (const it of items) {
    if (it.sep) { m.append(el('div', { class: 'msep' })); continue; }
    if (it.head) { m.append(el('div', { class: 'mhead' }, it.head)); continue; }
    const row = el('button', { class: 'mitem' + (it.active ? ' active' : ''), type: 'button' });
    if (it.icon) { const i = el('span', { class: 'micon' }); i.innerHTML = svgIcon(it.icon); row.append(i); }
    row.append(el('span', { class: 'mlabel' }, it.label));
    if (it.hint) row.append(el('span', { class: 'mhint' }, it.hint));
    row.addEventListener('click', () => { closeMenu(); it.onClick(); });
    m.append(row);
  }
  m.classList.remove('hidden');
  m.style.left = Math.max(4, Math.min(pos.x, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(pos.y, window.innerHeight - m.offsetHeight - 8)) + 'px';
}
function closeMenu() { $('#popMenu').classList.add('hidden'); menuOwner = null; }
document.addEventListener('pointerdown', (e) => {
  const m = $('#popMenu');
  if (!m.classList.contains('hidden') && !m.contains(e.target) && !e.target.closest('[data-menu-anchor]')) closeMenu();
}, true);

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
  else if (app.tab === 'gen') renderGenerate(body);
  else renderMapSettings(body);
}

const iconBtn = (title, text, fn, cls) => el('button', { title, class: cls || '', onclick: fn }, text);

function renderMulti(body) {
  const fs = selFeats();
  const counts = {};
  for (const f of fs) counts[S.TYPE_LABELS[f.type]] = (counts[S.TYPE_LABELS[f.type]] || 0) + 1;
  const anyHidden = fs.some((f) => f.hidden), anyLocked = fs.some((f) => f.locked);
  body.append(el('div', { class: 'prop-head' },
    el('h3', {}, `${fs.length} items selected`),
    el('div', { class: 'btns' },
      iconBtn('Duplicate (Ctrl+D)', '⧉', duplicateSelected),
      iconBtn(anyHidden ? 'Show all' : 'Hide all', anyHidden ? '◌' : '◉', () => { for (const f of fs) f.hidden = !anyHidden; S.commit(); }),
      iconBtn(anyLocked ? 'Unlock all' : 'Lock all', anyLocked ? '🔒' : '🔓', () => { for (const f of fs) f.locked = !anyLocked; S.commit(); }),
      iconBtn('Delete (Del)', '🗑', deleteSelected, 'danger'))));
  body.append(el('p', { class: 'info' }, Object.entries(counts).map(([k, v]) => `${v} × ${k}`).join(' · ')));
  body.append(el('p', { class: 'info' }, 'Drag any selected item to move them all together. Shift-click adds or removes items; Shift-drag on empty map box-selects.'));

  body.append(el('div', { class: 'heading' }, 'Group'));
  const grouped = fs.some((f) => f.groupId);
  body.append(el('div', { class: 'btnrow' },
    el('button', { title: 'Group these so one click on “Select group” grabs them all', onclick: () => { const gid = 'g' + S.newId(); for (const f of fs) { f.groupId = gid; delete f.groupName; } S.commit(); } }, 'Group'),
    grouped ? el('button', { onclick: () => { for (const f of fs) { delete f.groupId; delete f.groupName; } S.commit(); } }, 'Ungroup') : null));

  body.append(el('div', { class: 'heading' }, 'Align'));
  const row = (items) => el('div', { class: 'btnrow wrap' }, ...items.map(([t, label, fn]) => el('button', { title: t, onclick: fn }, label)));
  body.append(row([
    ['Align left edges', '⇤ Left', () => alignSel('left')], ['Center horizontally', '↔ Center', () => alignSel('hcenter')], ['Align right edges', 'Right ⇥', () => alignSel('right')],
    ['Align top edges', '⤒ Top', () => alignSel('top')], ['Center vertically', '↕ Middle', () => alignSel('vcenter')], ['Align bottom edges', 'Bottom ⤓', () => alignSel('bottom')],
  ]));
  body.append(el('div', { class: 'heading' }, 'Distribute'));
  body.append(row([['Space evenly left to right', '↔ Horizontally', () => distributeSel('h')], ['Space evenly top to bottom', '↕ Vertically', () => distributeSel('v')]]));
}

function renderProps(body) {
  if (app.selSet.size > 1) { renderMulti(body); return; }
  const f = app.sel && S.byId(app.sel);
  if (!f) {
    const t = toolById(app.tool);
    body.append(
      el('h3', {}, t.label),
      el('p', { class: 'info' }, t.hint),
      el('div', { class: 'heading' }, 'Getting around'),
      el('ul', { class: 'tips' },
        el('li', {}, 'Scroll to zoom, drag empty space (or hold Space / right-drag) to pan.'),
        el('li', {}, 'Click anything on the map to edit it here; Shift-click or Shift-drag to select several.'),
        el('li', {}, 'The Generate tab builds a whole city from an outline and places kits: market square, cemetery, park, keep.'),
        el('li', {}, 'Snapping and alignment guides are in the toolbar; hold Alt to bypass them for one action.'),
        el('li', {}, 'Everything autosaves in this browser. Use File → Save to keep a .json file.')),
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
  if (f.groupId) {
    const n = groupMembers(f.groupId).length;
    body.append(el('div', { class: 'groupbar' },
      el('span', {}, `In group “${f.groupName || 'Group'}” (${n} items)`),
      el('button', { title: 'Select every item in this group', onclick: () => setMulti(groupMembers(f.groupId), f.id) }, 'Select group'),
      el('button', { title: 'Remove this item from the group', onclick: () => { delete f.groupId; delete f.groupName; S.commit(); } }, 'Leave')));
  }
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

// ---------- Generate tab: city wizard + kits ----------
function setGenOutline(pts) {
  // Turn the rough sketch into a clean, smooth outline.
  let o = pts.map((p) => p.slice());
  if (o.length >= 4) o = CG.simplifyClosed(G.smoothPoints(o, true, 24), 2);
  app.genOutline = o;
  setTool('select');
  app.tab = 'gen';
  renderPanel(); requestRender();
  toast('Outline set. Choose the options on the Generate tab, then press Generate city.');
}

function useSelectedAsOutline() {
  const f = app.sel && S.byId(app.sel);
  if (!f || !isClosed(f) || isPointType(f)) { toast('Select a district, wall, lake or another closed area first, then press this again.'); return; }
  const sh = featureShape(f, S.getDoc());
  if (sh.length < 3) { toast('That item has no outline to use.'); return; }
  app.genOutline = CG.simplifyClosed(sh, 2);
  app.tab = 'gen';
  renderPanel(); requestRender();
  toast('Using the selected area as the outline.');
}

function runGenerate() {
  const doc = S.getDoc(), g = app.gen;
  const out = CG.generateCity({ ...g, outline: app.genOutline, W: doc.meta.width, H: doc.meta.height, furniture: g.clear });
  if (g.clear) { doc.features = out.features; doc.meta.title = out.name; doc.settings.seed = g.seed % 100000; }
  else for (const f of out.features) S.insertFeature(f);
  app.genOutline = null;
  app.sel = null;
  S.commit();
  fitView();
  toast(`Generated ${out.name}: ${out.features.length} features, all editable. Ctrl+Z undoes it.`);
}

function renderGenerate(body) {
  const g = app.gen, ol = app.genOutline;
  const city = collapsible(body, 'City from an outline', { key: 'gen-city' });
  city.append(el('p', { class: 'info' }, 'Sketch an outline (or use a random shape), choose the options, and a complete, editable city is built inside it: wall, districts, roads, plazas, buildings, river and farmland.'));
  city.append(el('div', { class: 'outline-box' },
    el('div', { class: 'obx-status' + (ol ? ' ok' : '') }, ol ? `✓ Outline ready (${ol.length} points)` : 'No outline yet — a random shape will be used'),
    el('div', { class: 'btnrow wrap' },
      el('button', { onclick: () => { setTool('outline'); toast('Drag to sketch the outline, then double-click to finish.'); } }, '✏ Draw outline'),
      el('button', { title: 'Use the shape of the selected district, wall, lake or other closed area', onclick: useSelectedAsOutline }, '◰ Use selected area'),
      ol ? el('button', { onclick: () => { app.genOutline = null; renderPanel(); requestRender(); } }, '✕ Clear') : null)));
  buildForm(city, [
    { k: 'districts', label: 'Districts', t: 'range', min: 1, max: 16, step: 1 },
    { k: 'splitMode', label: 'Arrangement', t: 'select', options: [['center', 'Core with rings around it'], ['even', 'Spread evenly']] },
    { k: 'density', label: 'Block density', t: 'select', options: [['edge', 'Tighter toward the edge'], ['center', 'Tighter toward the center'], ['none', 'Even']] },
    { k: 'walled', label: 'City wall with gates', t: 'check' },
    { k: 'gates', label: 'Main roads', t: 'range', min: 2, max: 12, step: 1 },
    { k: 'ring', label: 'Ring road', t: 'check' },
    { k: 'river', label: 'River', t: 'select', options: [['through', 'Through the city'], ['edge', 'Along one side'], ['none', 'None']] },
    { k: 'farmland', label: 'Farmland outside', t: 'check' },
    { k: 'halls', label: 'Large buildings', t: 'range', min: 0, max: 20, step: 1 },
    { k: 'size', label: 'Size (random shape)', t: 'range', min: 250, max: 1100, step: 10, show: () => !app.genOutline },
    { k: 'seed', label: 'Seed', t: 'seed' },
    { k: 'clear', label: 'Replace everything on the map', t: 'check', rebuild: true },
  ], g, { onInput() {}, onCommit() {}, rebuild: () => renderPanel() });
  city.append(el('button', { class: 'primary wide', onclick: runGenerate }, '✨ Generate city'));
  if (!g.clear) city.append(el('p', { class: 'info' }, 'The new city will be added to what is already on the map.'));

  const kits = collapsible(body, 'Kits: ready-made groups', { key: 'gen-kits', collapsed: true });
  kits.append(el('p', { class: 'info' }, 'Place a whole group at once: pick a kit, set its size, press Place, then click the map. The pieces arrive selected together so you can drag them into position as one.'));
  for (const kit of KITS) {
    const st = app.kitState[kit.id];
    const ks = collapsible(kits, kit.name, { key: 'kit-' + kit.id, collapsed: true });
    ks.append(el('p', { class: 'info' }, kit.desc));
    buildForm(ks, kit.params.map((p) => ({ k: p.k, label: p.label, t: p.t, min: p.min, max: p.max, step: p.step })), st, { onInput() {}, onCommit() {}, rebuild: () => {} });
    ks.append(el('button', {
      class: 'primary wide',
      onclick: () => { app.kit = { def: kit, params: { ...st } }; setTool('kit'); toast(`Click on the map to place the ${kit.name.toLowerCase()}.`); },
    }, `Place ${kit.name.toLowerCase()}…`));
  }
}

// Split a district into several, using the same method the city generator uses.
function autoSplit(f, n, mode, vary, dense) {
  const doc = S.getDoc();
  if (f.type !== 'district') return;
  const exact = !!(f.followWall || f.smooth);
  let P = exact ? featureShape(f, doc) : f.points;
  if (!P || P.length < 3) return;
  if (exact) P = CG.simplifyClosed(P, 1);
  const rng = makeRng(((f.seed >>> 0) + n * 977) >>> 0), c = G.centroid(P);
  const cells = CG.voronoiSplit(P, CG.districtSeeds(c, P, n, rng, mode)).filter(Boolean);
  if (cells.length < 2) { toast('That area is too small or too thin to split that many ways.'); return; }
  const presets = vary ? CG.assignStyles(cells, c, P, rng) : null;
  if (f.followWall) { if (!f.clipWall) f.clipWall = f.followWall; f.followWall = ''; }
  if (exact) f.smooth = false;
  const base = JSON.parse(JSON.stringify(f));
  const radius = Math.max(...P.map((p) => G.dist(p, c)));
  const ids = [];
  cells.forEach((cell, i) => {
    const d = i === 0 ? f : Object.assign(JSON.parse(JSON.stringify(base)), { id: S.newId(), seed: Math.floor(Math.random() * 1e9) });
    d.points = cell; d.locked = false;
    d.name = vary || !base.name ? CG.districtName(rng) : `${base.name} ${i + 1}`;
    d.borderStreet = Math.max(+d.borderStreet || 0, 3.5);
    d.labelSize = Math.round(Math.max(14, Math.min(54, Math.sqrt(Math.abs(G.polyArea(cell))) * 0.11)));
    if (presets) {
      const pr = { ...PRESETS[presets[i]] };
      if (pr.pattern === 'radial') pr.pattern = 'organic';
      Object.assign(d, pr, { preset: presets[i] });
    }
    if (dense && (d.look || 'blocks') === 'blocks') Object.assign(d, { gradMode: 'edge', gradStrength: 0.6, gradCenter: c.slice(), gradRadius: radius });
    if (i > 0) doc.features.splice(doc.features.indexOf(f) + i, 0, d);
    ids.push(d.id);
  });
  setMulti(ids);
  S.commit();
  toast(`Split into ${cells.length} districts, all selected. Pick any one to restyle it.`);
}

function buildAutoSplit(target, f) {
  const sp = app.split;
  const n = el('input', { type: 'number', min: 2, max: 16, step: 1, value: sp.n });
  n.addEventListener('input', () => { sp.n = Math.max(2, Math.min(16, parseInt(n.value, 10) || 2)); });
  const mode = el('select', {}, el('option', { value: 'center', selected: sp.mode === 'center' }, 'Core with rings'), el('option', { value: 'even', selected: sp.mode === 'even' }, 'Spread evenly'));
  mode.addEventListener('change', () => { sp.mode = mode.value; });
  const mk = (key, text) => { const cb = el('input', { type: 'checkbox', checked: !!sp[key] }); cb.addEventListener('change', () => { sp[key] = cb.checked; }); return el('label', { class: 'mrow' }, cb, ' ' + text); };
  target.append(el('div', { class: 'autosplit' },
    el('div', { class: 'astitle' }, '⚙ Split into districts automatically'),
    el('div', { class: 'asrow' }, el('span', {}, 'Districts'), n, mode),
    mk('vary', 'Give each its own style'),
    mk('dense', 'Tighter blocks toward the edge'),
    el('button', { type: 'button', class: 'wide primary', onclick: () => autoSplit(f, sp.n, sp.mode, sp.vary, sp.dense) }, 'Split automatically')));
}

function renderLayers(body) {
  const doc = S.getDoc();
  body.append(el('p', { class: 'info' }, 'Top of the list draws on top. Drag rows (or use ▲▼) to reorder — e.g. put a lake above a river. Roads, rivers, lakes, walls and buildings placed above a district cut through its blocks. Shift-click rows to select several. Area and river names always stay on top.'));
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
    const row = el('div', { class: 'layer' + (app.selSet.has(f.id) ? ' sel' : '') + (f.hidden ? ' hidden' : '') + (f.groupId ? ' grouped' : ''), title: f.groupId ? `Group: ${f.groupName || 'Group'}` : '' },
      el('span', { class: 'grip', title: 'Drag to reorder' }, '⠿'), icon,
      el('span', { class: 'lname', title: name }, name),
      el('button', { title: 'Move up (draw above)', onclick: (e) => { e.stopPropagation(); move(1); } }, '▲'),
      el('button', { title: 'Move down (draw below)', onclick: (e) => { e.stopPropagation(); move(-1); } }, '▼'),
      el('button', { title: f.hidden ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); f.hidden = !f.hidden; S.commit(); } }, f.hidden ? '◌' : '◉'),
      el('button', { title: f.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); f.locked = !f.locked; S.commit(); } }, f.locked ? '🔒' : '🔓'));
    row.dataset.id = f.id;
    row.addEventListener('click', (e) => {
      if (row.dataset.dragged) return;
      if (e.shiftKey) toggleSelect(f.id); else { app.sel = f.id; renderPanel(); requestRender(); }
    });
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
  const page = collapsible(body, 'Page', { key: 'map-page' });
  buildForm(page, [
    { k: 'title', label: 'File name', t: 'text' },
    { k: 'width', label: 'Page width', t: 'number', min: 300, max: 10000, step: 10 },
    { k: 'height', label: 'Page height', t: 'number', min: 300, max: 10000, step: 10 },
  ], doc.meta, h);
  const fontOpts = FONTS.map((f) => [f, f]);
  const theme = collapsible(body, 'Theme & fonts', { key: 'map-theme' });
  buildForm(theme, [
    { k: 'theme', label: 'Theme', t: 'select', options: Object.entries(THEMES).map(([k, v]) => [k, v.name]), rebuild: true, onChange: (s) => { s.colors = {}; } },
    { k: 'fontLabel', label: 'Label font', t: 'select', options: fontOpts },
    { k: 'fontTitle', label: 'Title font', t: 'select', options: fontOpts },
    { k: 'fontScript', label: 'Script font', t: 'select', options: fontOpts },
  ], doc.settings, h);
  const deco = collapsible(body, 'Decoration', { key: 'map-deco', collapsed: true });
  buildForm(deco, [
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
  const colors = collapsible(body, 'Colors', { key: 'map-colors', collapsed: true });
  colors.append(el('p', { class: 'info' }, '× resets a color to the theme default.'));
  buildForm(colors, COLOR_KEYS.map(([k, l]) => ({ k, label: l, t: 'color' })), doc.settings.colors, h);

  const tracing = collapsible(body, 'Tracing image', { key: 'map-trace', collapsed: true });
  tracing.append(el('p', { class: 'info' }, 'Load a sketch or reference map to trace over. It is shown only in the editor, never exported, and stays in this browser only.'));
  const row = el('div', { class: 'btnrow' },
    el('button', { onclick: () => $('#fileRef').click() }, ref.img ? 'Replace image…' : 'Load image…'));
  if (ref.img) row.append(el('button', { onclick: () => { ref.img = null; ref.src = null; saveRef(); renderPanel(); requestRender(); } }, 'Remove'));
  tracing.append(row);
  if (ref.img) {
    buildForm(tracing, [
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

function exportPNG(scale) {
  const doc = S.getDoc(), k = scale || app.exportScale || 2;
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

function toggleHelp(show) { $('#help').classList.toggle('hidden', !show); }

// ---------- snap menu ----------
function syncSnapButton() {
  $('#btnSnap').classList.toggle('on', SN.snap.enabled);
  $('#btnSnap').setAttribute('aria-pressed', String(SN.snap.enabled));
}
function toggleSnap() {
  SN.snap.enabled = !SN.snap.enabled;
  SN.saveSnap(); syncSnapButton(); clearSnap(); requestRender();
  toast(SN.snap.enabled ? 'Snapping on' : 'Snapping off');
}
function openSnapMenu() {
  const menu = $('#snapMenu');
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  menu.innerHTML = '';
  const row = (k, text) => {
    const cb = el('input', { type: 'checkbox', checked: !!SN.snap[k] });
    cb.addEventListener('change', () => { SN.snap[k] = cb.checked; SN.saveSnap(); requestRender(); });
    return el('label', { class: 'mrow' }, cb, ' ' + text);
  };
  const gs = el('input', { type: 'number', min: 2, max: 500, step: 1, value: SN.snap.gridSize });
  gs.addEventListener('input', () => { const v = parseFloat(gs.value); if (v > 0) { SN.snap.gridSize = v; SN.saveSnap(); requestRender(); } });
  menu.append(
    el('div', { class: 'mhead' }, 'Snapping'),
    row('enabled', 'Snapping on (Shift+G)'),
    row('points', 'Snap to corner points'),
    row('edges', 'Snap onto edges'),
    row('guides', 'Alignment guides (line up with other points)'),
    row('angle', 'Shift while drawing: lock to 15° steps'),
    el('div', { class: 'mhead' }, 'Grid'),
    row('grid', 'Snap to grid'),
    row('showGrid', 'Show grid'),
    el('label', { class: 'mrow' }, 'Grid size ', gs),
    el('div', { class: 'mnote' }, 'Hold Alt to bypass snapping for a single action.'),
  );
  const b = $('#btnSnap').getBoundingClientRect();
  menu.style.left = Math.min(b.left, window.innerWidth - 300) + 'px';
  menu.style.top = b.bottom + 6 + 'px';
  menu.classList.remove('hidden');
}
$('#btnSnap').addEventListener('click', toggleSnap);
$('#btnSnapMenu').addEventListener('click', (e) => { e.stopPropagation(); openSnapMenu(); });
document.addEventListener('pointerdown', (e) => {
  const m = $('#snapMenu');
  if (!m.classList.contains('hidden') && !m.contains(e.target) && e.target.id !== 'btnSnapMenu') m.classList.add('hidden');
});

// ---------- top bar ----------
// Swap in a whole new map as one undoable step (Ctrl+Z brings the old one back).
function replaceDoc(next) {
  app.sel = null;
  const d = S.getDoc();
  d.features = next.features; d.meta = next.meta; d.settings = next.settings;
  S.commit();
  fitView();
}
function newBlank() {
  if (!confirm('Start a blank map? (Ctrl+Z undoes this.)')) return;
  replaceDoc(S.blankDoc());
}
function newRandom() {
  if (!confirm('Replace the current map with a new random city? (Ctrl+Z undoes this.)')) return;
  replaceDoc(CG.randomCityDoc());
}
function openGenerate() { app.tab = 'gen'; renderPanel(); }

function openFileMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const exp = (k, text) => ({ label: text, onClick: () => { app.exportScale = k; exportPNG(k); } });
  showMenu({ x: r.left, y: r.bottom + 6 }, [
    { label: 'Generate a city…', hint: 'outline wizard', onClick: openGenerate },
    { label: 'New random city', onClick: newRandom },
    { label: 'New blank map', onClick: newBlank },
    { sep: true },
    { label: 'Open…', onClick: () => $('#fileOpen').click() },
    { label: 'Save map file', hint: 'Ctrl+S', onClick: saveJSON },
    { sep: true },
    { head: 'Export PNG' },
    exp(1, 'Small (1×)'), exp(2, 'Standard (2×)'), exp(3, 'Large (3×)'),
    { sep: true },
    { label: 'Keyboard shortcuts', hint: '?', onClick: () => toggleHelp(true) },
  ], 'file');
}
$('#btnFile').addEventListener('click', (e) => openFileMenu(e.currentTarget));
$('#btnGenerate').addEventListener('click', openGenerate);
$('#btnExport').addEventListener('click', () => exportPNG(app.exportScale));
$('#btnUndo').addEventListener('click', () => S.undo());
$('#btnRedo').addEventListener('click', () => S.redo());
$('#btnFit').addEventListener('click', fitView);
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
    pruneSel();
    if (!(source === 'panel' && app.tab !== 'layers')) renderPanel();
  }
  requestRender();
});

SN.loadSnap();
syncSnapButton();
new ResizeObserver(resize).observe($('#stage'));
renderTools();
const saved = S.loadSaved();
S.setDoc(saved && Array.isArray(saved.features) ? saved : CG.randomCityDoc());
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
