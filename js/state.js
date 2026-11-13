// The map document, undo/redo history and autosave.

import { PRESETS } from './generate.js';

const STORAGE_KEY = 'citybuilder.doc.v1';

export const TYPE_LABELS = {
  wall: 'Wall', district: 'District', cutout: 'Cut-away', farm: 'Farmland', water: 'Lake / Sea', river: 'River / Canal', road: 'Road',
  plaza: 'Plaza', building: 'Building', landmark: 'Landmark', label: 'Label', compass: 'Compass',
};

// Default bottom-to-top order. Features are drawn in array order, so the user can
// rearrange them freely; this only decides where a newly drawn feature is inserted.
export const DEFAULT_ORDER = ['farm', 'water', 'district', 'cutout', 'river', 'road', 'plaza', 'building', 'wall', 'landmark', 'label', 'compass'];
const rank = (t) => { const i = DEFAULT_ORDER.indexOf(t); return i < 0 ? DEFAULT_ORDER.length : i; };

export function sortByDefaultOrder(features) {
  return features.map((f, i) => [f, i]).sort((a, b) => rank(a[0].type) - rank(b[0].type) || a[1] - b[1]).map((x) => x[0]);
}

export const DEFAULTS = {
  wall: { name: 'City Wall', closed: true, width: 7, towerSpacing: 60, towerSize: 5, cornerTowers: true, smooth: false, gates: true },
  district: {
    name: 'New District', showLabel: true, labelSize: 42, labelAngle: 0, labelSpacing: 0.12, labelOffset: [0, 0], halo: null,
    preset: 'standard', ...PRESETS.standard, gridAngle: 0, color: '', borderStreet: 3,
    smooth: false, followWall: '', clipWall: '', seed: 1,
  },
  cutout: { name: '', fill: 'none', gap: 0, smooth: false },
  farm: {
    name: '', showLabel: false, labelSize: 32, labelAngle: 0, labelSpacing: 0.15, labelOffset: [0, 0], halo: null,
    parcelSize: 110, pattern: 'organic', irregularity: 0.6, warp: 6, gridAngle: 0,
    furrows: true, furrowSpacing: 6, hedges: true, smooth: false, clipWall: '', seed: 1,
  },
  water: { name: '', showLabel: false, labelSize: 48, labelAngle: 0, labelSpacing: 0.25, labelOffset: [0, 0], halo: null, coastLines: 3, smooth: true },
  river: { name: 'River', showLabel: true, labelSize: 34, labelSpacing: 1.0, labelPos: 0.5, labelOpacity: 0.7, halo: null, width: 60, wobble: 0.15, canal: false, smooth: true },
  road: { name: '', kind: 'avenue', width: 13, ruralOutside: true, gates: true, closed: false, smooth: true },
  plaza: { name: '', radius: 22, shape: 'round', aspect: 1, angle: 0, monument: 'dot' },
  building: {
    name: '', style: 'solid', tone: 'normal', hatch: true, color: '', smooth: false,
    shape: 'free', size: 24, aspect: 1.5, inner: 0.45, angle: 0,
  },
  landmark: { name: 'Landmark', size: 6, showLabel: true, labelSize: 20, labelOffset: [0, -28], halo: null },
  label: { text: 'Label', style: 'district', size: 40, angle: 0, spacing: 0.12, color: '', halo: null },
  compass: { size: 120, angle: 0 },
};

export function defaultSettings() {
  return {
    theme: 'patina', colors: {}, frame: true, frameStyle: 'solid', frameWidth: 30, fields: true, fieldSize: 170,
    hatch: true, hatchSpacing: 3.6, outline: 1.2, glow: true, glowSize: 40, featureGap: 4, haloWidth: 0.34,
    fontLabel: 'Cinzel', fontTitle: 'Oswald', fontScript: 'IM Fell English', seed: 1,
  };
}

export function blankDoc() {
  return { version: 2, meta: { title: 'New City', width: 3000, height: 2200 }, settings: defaultSettings(), features: [] };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export function newId() {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function createFeature(type, points, extra = {}) {
  const f = { id: newId(), type, points: clone(points), ...clone(DEFAULTS[type] || {}), ...clone(extra) };
  if ((type === 'district' || type === 'farm') && extra.seed == null) f.seed = Math.floor(Math.random() * 1e9);
  return f;
}

// Insert a new feature at its natural depth: just above the last feature of the
// same or a lower default rank.
export function insertFeature(f) {
  const arr = doc.features;
  let at = 0;
  for (let i = 0; i < arr.length; i++) if (rank(arr[i].type) <= rank(f.type)) at = i + 1;
  arr.splice(at, 0, f);
  return f;
}

function migrate(doc, version) {
  if (version < 2) {
    doc.features = sortByDefaultOrder(doc.features);
    if (doc.settings.theme === 'ash') doc.settings.frameStyle = 'ornate';
  }
  const firstWall = doc.features.find((f) => f.type === 'wall');
  for (const f of doc.features) {
    if (f.clipWall === true) f.clipWall = 'all';
    if (f.clipWall === false || f.clipWall == null) f.clipWall = '';
    if (f.followWall === true) f.followWall = firstWall ? firstWall.id : '';
    if (f.followWall === false || f.followWall == null) f.followWall = '';
  }
  doc.version = 2;
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
    migrate(doc, d.version || 1);
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
