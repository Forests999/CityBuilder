// The map document, undo/redo history and autosave.

import { PRESETS } from './generate.js';

const STORAGE_KEY = 'citybuilder.doc.v1';

export const TYPE_LABELS = {
  wall: 'Wall', district: 'District', water: 'Lake / Sea', river: 'River / Canal', road: 'Road',
  plaza: 'Plaza', building: 'Building', landmark: 'Landmark', label: 'Label', compass: 'Compass',
};

// Bottom-to-top drawing order; also the grouping used by the Layers tab.
export const RENDER_ORDER = ['water', 'district', 'river', 'road', 'plaza', 'building', 'wall', 'landmark', 'label', 'compass'];

export const DEFAULTS = {
  wall: { name: 'City Wall', width: 7, towerSpacing: 60, towerSize: 5, smooth: false, gates: true },
  district: {
    name: 'New District', showLabel: true, labelSize: 30, labelAngle: 0, labelSpacing: 0.35, labelOffset: [0, 0],
    preset: 'standard', ...PRESETS.standard, gridAngle: 0, color: '', borderStreet: 3,
    smooth: false, followWall: false, clipWall: false, seed: 1,
  },
  water: { name: '', showLabel: false, labelSize: 40, labelAngle: 0, labelSpacing: 0.4, labelOffset: [0, 0], coastLines: 3, smooth: true },
  river: { name: 'River', showLabel: true, labelSize: 26, labelSpacing: 1.0, labelPos: 0.5, width: 60, wobble: 0.15, canal: false, smooth: true },
  road: { name: '', kind: 'avenue', width: 13, ruralOutside: true, gates: true, closed: false, smooth: true },
  plaza: { name: '', radius: 22, monument: 'dot' },
  building: { name: '', style: 'solid', smooth: false },
  landmark: { name: 'Landmark', size: 6, showLabel: true, labelSize: 15, labelOffset: [0, -22] },
  label: { text: 'Label', style: 'district', size: 30, angle: 0, spacing: 0.3, color: '' },
  compass: { size: 120 },
};

export function defaultSettings() {
  return {
    theme: 'ash', colors: {}, frame: true, frameWidth: 36, fields: true, fieldSize: 170,
    hatch: true, hatchSpacing: 3.6, outline: 1.2, glow: true, glowSize: 40,
    fontLabel: 'Cinzel', fontTitle: 'Oswald', fontScript: 'IM Fell English', seed: 1,
  };
}

export function blankDoc() {
  return { version: 1, meta: { title: 'New City', width: 3000, height: 2200 }, settings: defaultSettings(), features: [] };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export function newId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createFeature(type, points, extra = {}) {
  const f = { id: newId(), type, points: clone(points), ...clone(DEFAULTS[type] || {}), ...clone(extra) };
  if (type === 'district' && extra.seed == null) f.seed = Math.floor(Math.random() * 1e9);
  return f;
}

function normalize(d) {
  const doc = blankDoc();
  if (d && typeof d === 'object') {
    Object.assign(doc.meta, d.meta || {});
    Object.assign(doc.settings, d.settings || {});
    doc.settings.colors = { ...(d.settings && d.settings.colors) };
    doc.features = Array.isArray(d.features) ? d.features.filter((f) => f && DEFAULTS[f.type]).map((f) => ({
      ...clone(DEFAULTS[f.type]), ...f, id: f.id || newId(), points: Array.isArray(f.points) ? f.points : [],
    })) : [];
  }
  return doc;
}

let doc = blankDoc();
let past = [], future = [], snap = JSON.stringify(doc);
const listeners = new Set();

export const getDoc = () => doc;
export const byId = (id) => doc.features.find((f) => f.id === id);
export const onChange = (fn) => listeners.add(fn);
const emit = (kind, source) => listeners.forEach((fn) => fn(kind, source));

function save() {
  try { localStorage.setItem(STORAGE_KEY, snap); } catch (e) { /* storage full or blocked */ }
}

export function loadSaved() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

export function setDoc(d) {
  doc = normalize(d);
  past = []; future = [];
  snap = JSON.stringify(doc);
  save();
  emit('doc', 'load');
}

// Live, uncommitted edit (dragging, typing): redraw only.
export function touch() { emit('render'); }

// Record the current state as one undo step.
export function commit(source) {
  const s = JSON.stringify(doc);
  if (s === snap) { emit('render'); return; }
  past.push(snap);
  if (past.length > 150) past.shift();
  future = [];
  snap = s;
  save();
  emit('doc', source);
}

export function undo() {
  if (JSON.stringify(doc) !== snap) commit();
  if (!past.length) return;
  future.push(snap);
  snap = past.pop();
  doc = JSON.parse(snap);
  save();
  emit('doc', 'history');
}

export function redo() {
  if (!future.length) return;
  past.push(snap);
  snap = future.pop();
  doc = JSON.parse(snap);
  save();
  emit('doc', 'history');
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
