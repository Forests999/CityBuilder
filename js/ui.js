// Property panels: a small schema-driven form builder.

import { PRESETS, PRESET_LABELS } from './generate.js';
import { BUILDING_SHAPES } from './shapes.js';
import { LABEL_STYLES } from './render.js';

const opts = (o) => Object.entries(o);
const label = (k) => ({ k, label: 'Name', t: 'text' });
const GAP = { k: 'gap', label: 'White gap around it', t: 'optrange', min: 0, max: 20, step: 0.5, fallback: (c) => c.gapDefault() };

export const SCHEMAS = {
  wall: [
    label('name'),
    { k: 'width', label: 'Thickness', t: 'range', min: 1, max: 30, step: 0.5 },
    { k: 'towerSpacing', label: 'Tower spacing', t: 'range', min: 15, max: 300, step: 1 },
    { k: 'towerSize', label: 'Tower size', t: 'range', min: 0, max: 20, step: 0.5 },
    { k: 'cornerTowers', label: 'Towers at sharp corners', t: 'check' },
    { k: 'closed', label: 'Closed loop', t: 'check', rebuild: true },
    { k: 'gates', label: 'Gates at roads', t: 'check' },
    GAP,
    { k: 'smooth', label: 'Smooth curve', t: 'check' },
  ],
  district: [
    label('name'),
    { t: 'heading', label: 'Style' },
    { k: 'preset', label: 'Style preset', t: 'select', options: opts(PRESET_LABELS), rebuild: true,
      onChange: (f) => Object.assign(f, PRESETS[f.preset]) },
    { k: 'tone', label: 'Tone', t: 'select', options: [['normal', 'Normal'], ['dark', 'Dark (slums, industry)'], ['light', 'Light (wealthy)'], ['park', 'Park']], show: (f) => (f.look || 'blocks') === 'blocks' },
    { k: 'color', label: 'Custom fill', t: 'color' },
    { k: 'hatch', label: 'Hatching', t: 'check', show: (f) => (f.look || 'blocks') === 'blocks' },
    { k: 'borderStreet', label: 'Border street', t: 'range', min: 0, max: 20, step: 0.5 },
    { t: 'heading', label: 'Streets' },
    { k: 'blockSize', label: 'Block size', t: 'range', min: 8, max: 400, step: 1 },
    { k: 'streetWidth', label: 'Street width', t: 'range', min: 0.5, max: 14, step: 0.1 },
    { k: 'pattern', label: 'Pattern', t: 'select', options: [['organic', 'Organic'], ['radial', 'Radial / rings'], ['grid', 'Grid']], rebuild: true },
    { k: 'gridAngle', label: 'Grid angle', t: 'range', min: 0, max: 180, step: 1, show: (f) => f.pattern === 'grid' },
    { k: 'seed', label: 'Layout seed', t: 'seed' },
    { t: 'heading', label: 'Density' },
    { k: 'gradMode', label: 'Block density', t: 'select', rebuild: true, options: [['none', 'Even'], ['edge', 'Tighter toward the edge'], ['center', 'Tighter toward the center']] },
    { k: 'gradStrength', label: 'Strength', t: 'range', min: 0, max: 1.5, step: 0.05, show: (f) => (f.gradMode || 'none') !== 'none' },
    { t: 'info', text: 'Blocks get smaller where the city is denser. The gradient is measured from the middle of this district unless it was generated with a city, which shares one center.', show: (f) => (f.gradMode || 'none') !== 'none' },
    { k: 'popFactor', label: 'Population weight', t: 'range', min: 0, max: 3, step: 0.05 },
    { t: 'heading', label: 'More street options', collapsed: true },
    { k: 'look', label: 'Look', t: 'select', options: [['blocks', 'Buildings (blocks)'], ['garden', 'Park / garden (trees)'], ['cemetery', 'Cemetery (headstones)']], rebuild: true },
    { k: 'irregularity', label: 'Irregularity', t: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'warp', label: 'Curviness', t: 'range', min: 0, max: 40, step: 0.5 },
    { k: 'lots', label: 'Building lots', t: 'check' },
    { k: 'courtyards', label: 'Open squares', t: 'range', min: 0, max: 0.6, step: 0.01 },
    { k: 'alignRoads', label: 'Align streets to roads', t: 'check' },
    { k: 'treeSpacing', label: 'Tree spacing', t: 'range', min: 7, max: 40, step: 0.5, show: (f) => f.look === 'garden' },
    { k: 'treeDensity', label: 'Tree density', t: 'range', min: 0, max: 1, step: 0.01, show: (f) => f.look === 'garden' },
    { k: 'graveSpacing', label: 'Headstone spacing', t: 'range', min: 5, max: 24, step: 0.5, show: (f) => f.look === 'cemetery' },
    { t: 'heading', label: 'Label', collapsed: true },
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 160, step: 1 },
    { k: 'labelAngle', label: 'Label angle', t: 'range', min: -90, max: 90, step: 1 },
    { k: 'labelSpacing', label: 'Letter spacing', t: 'range', min: 0, max: 1.5, step: 0.05 },
    { k: 'halo', label: 'Label border', t: 'optrange', min: 0, max: 0.8, step: 0.01 },
    { t: 'heading', label: 'Shape', collapsed: true },
    { k: 'followWall', label: 'Shape follows', t: 'select', rebuild: true, options: (f, ctx) => [['', 'Its own outline'], ...ctx.wallOptions()],
      onChange: (f, ctx, prev) => ctx.unlinkWall(f, prev) },
    { k: 'clipWall', label: 'Clip to wall', t: 'select', options: (f, ctx) => [['', 'Off'], ['all', 'Inside any wall'], ...ctx.wallOptions()] },
    { k: 'smooth', label: 'Smooth edges', t: 'check', show: (f) => !f.followWall },
    { t: 'heading', label: 'Tools' },
    { t: 'custom', render: (target, f, h) => h.ctx.autoSplitUI(target, f) },
    { t: 'button', label: '✂ Split with a line', help: 'Draw a line across this district to break it into two.', action: (f, ctx) => ctx.startSplit(f) },
    { t: 'button', label: '🏰 Create wall around it', help: 'Adds a wall that traces this outline exactly and clips the district to it.', action: (f, ctx) => ctx.wallFromArea(f) },
    { t: 'button', label: '🏰 Wall only free edges', help: 'Adds wall segments along the borders that do not touch another district.', action: (f, ctx) => ctx.wallFromFreeEdges(f) },
  ],
  farm: [
    label('name'),
    { t: 'heading', label: 'Label', collapsed: true },
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 160, step: 1 },
    { k: 'labelAngle', label: 'Label angle', t: 'range', min: -90, max: 90, step: 1 },
    { k: 'halo', label: 'Label border', t: 'optrange', min: 0, max: 0.8, step: 0.01 },
    { t: 'heading', label: 'Fields' },
    { k: 'pattern', label: 'Pattern', t: 'select', options: [['organic', 'Organic'], ['radial', 'Radial'], ['grid', 'Grid (strip fields)']], rebuild: true },
    { k: 'gridAngle', label: 'Grid angle', t: 'range', min: 0, max: 180, step: 1, show: (f) => f.pattern === 'grid' },
    { k: 'parcelSize', label: 'Field size', t: 'range', min: 20, max: 500, step: 1 },
    { k: 'irregularity', label: 'Irregularity', t: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'warp', label: 'Curviness', t: 'range', min: 0, max: 40, step: 0.5 },
    { k: 'furrows', label: 'Furrow lines', t: 'check' },
    { k: 'furrowSpacing', label: 'Furrow spacing', t: 'range', min: 2, max: 20, step: 0.5 },
    { k: 'hedges', label: 'Hedgerows', t: 'check' },
    { k: 'seed', label: 'Layout seed', t: 'seed' },
    { t: 'heading', label: 'Shape' },
    { k: 'clipWall', label: 'Clip to wall', t: 'select', options: (f, ctx) => [['', 'Off'], ['all', 'Inside any wall'], ...ctx.wallOptions()] },
    { k: 'smooth', label: 'Smooth edges', t: 'check' },
    { t: 'button', label: '✂ Split with a line', action: (f, ctx) => ctx.startSplit(f) },
  ],
  water: [
    label('name'),
    { t: 'heading', label: 'Label', collapsed: true },
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 160, step: 1 },
    { k: 'labelAngle', label: 'Label angle', t: 'range', min: -90, max: 90, step: 1 },
    { k: 'labelSpacing', label: 'Letter spacing', t: 'range', min: 0, max: 1.5, step: 0.05 },
    { k: 'halo', label: 'Label border', t: 'optrange', min: 0, max: 0.8, step: 0.01 },
    { t: 'heading', label: 'Water' },
    { k: 'coastLines', label: 'Coast lines', t: 'range', min: 0, max: 8, step: 1 },
    GAP,
    { k: 'smooth', label: 'Smooth shore', t: 'check' },
  ],
  river: [
    label('name'),
    { t: 'heading', label: 'Label', collapsed: true },
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 120, step: 1 },
    { k: 'labelSpacing', label: 'Letter spacing', t: 'range', min: 0, max: 3, step: 0.05 },
    { k: 'halo', label: 'Label border', t: 'optrange', min: 0, max: 0.8, step: 0.01 },
    { k: 'labelOpacity', label: 'Label opacity', t: 'range', min: 0.15, max: 1, step: 0.05 },
    { k: 'labelPos', label: 'Label position', t: 'range', min: 0, max: 1, step: 0.005 },
    { t: 'heading', label: 'River' },
    { k: 'width', label: 'Width', t: 'range', min: 3, max: 250, step: 1 },
    { k: 'wobble', label: 'Bank wobble', t: 'range', min: 0, max: 0.6, step: 0.01, show: (f) => !f.canal },
    { k: 'canal', label: 'Canal (stone-lined)', t: 'check', rebuild: true },
    GAP,
    { k: 'smooth', label: 'Smooth curve', t: 'check' },
  ],
  road: [
    label('name'),
    { k: 'kind', label: 'Kind', t: 'select', options: [['avenue', 'Avenue (wide, white)'], ['street', 'Street'], ['rural', 'Country road (thin line)']], rebuild: true },
    { k: 'width', label: 'Width', t: 'range', min: 1, max: 50, step: 0.5 },
    { k: 'ruralOutside', label: 'Thin line outside wall', t: 'check', show: (f) => f.kind !== 'rural' },
    { k: 'gates', label: 'Gate where it crosses wall', t: 'check', show: (f) => f.kind !== 'rural' },
    { k: 'closed', label: 'Closed loop', t: 'check' },
    { k: 'smooth', label: 'Smooth curve', t: 'check' },
    { k: 'carve', label: 'Shape the districts around it', t: 'check' },
    { t: 'info', text: 'On: blocks are cut away around the road and nearby generated streets line up with it. Off: the road is simply drawn over the districts and leaves them untouched.' },
  ],
  plaza: [
    label('name'),
    { k: 'shape', label: 'Shape', t: 'select', options: [['round', 'Round'], ['square', 'Square / rectangle']], rebuild: true },
    { k: 'radius', label: 'Radius / half-size', t: 'range', min: 3, max: 200, step: 1 },
    { k: 'aspect', label: 'Width ÷ height', t: 'range', min: 0.3, max: 3, step: 0.05, show: (f) => f.shape === 'square' },
    { k: 'angle', label: 'Rotation', t: 'range', min: -90, max: 90, step: 1, show: (f) => f.shape === 'square' },
    { k: 'monument', label: 'Centerpiece', t: 'select', options: [['none', 'None'], ['dot', 'Statue (dot)'], ['ring', 'Ring'], ['fountain', 'Fountain'], ['obelisk', 'Obelisk'], ['tree', 'Tree / garden'], ['market', 'Market stalls']] },
  ],
  building: [
    label('name'),
    { t: 'heading', label: 'Shape' },
    { k: 'shape', label: 'Shape preset', t: 'select', options: BUILDING_SHAPES, rebuild: true, onChange: (f, ctx) => ctx.reshapeBuilding(f) },
    { k: 'size', label: 'Size', t: 'range', min: 4, max: 300, step: 1, live: true, show: (f) => f.shape !== 'free', onChange: (f, ctx) => ctx.reshapeBuilding(f) },
    { k: 'aspect', label: 'Width ÷ height', t: 'range', min: 0.3, max: 4, step: 0.05, live: true, show: (f) => f.shape === 'rect', onChange: (f, ctx) => ctx.reshapeBuilding(f) },
    { k: 'inner', label: 'Point depth', t: 'range', min: 0.15, max: 0.9, step: 0.01, live: true, show: (f) => /^star/.test(f.shape), onChange: (f, ctx) => ctx.reshapeBuilding(f) },
    { k: 'angle', label: 'Rotation', t: 'range', min: -180, max: 180, step: 1, live: true, show: (f) => f.shape !== 'free', onChange: (f, ctx) => ctx.reshapeBuilding(f) },
    { k: 'smooth', label: 'Smooth edges', t: 'check' },
    { t: 'heading', label: 'Look' },
    { k: 'style', label: 'Fill', t: 'select', rebuild: true, options: [['solid', 'Solid ink'], ['district', 'Like district blocks (fill, hatching, lines)'], ['light', 'Light (street color)'], ['block', 'Block color'], ['accent', 'Accent'], ['park', 'Park'], ['water', 'Water']] },
    { k: 'tone', label: 'Block tone', t: 'select', options: [['normal', 'Normal'], ['dark', 'Dark'], ['light', 'Light'], ['park', 'Park']], show: (f) => f.style === 'district' },
    { k: 'hatch', label: 'Hatching', t: 'check', show: (f) => f.style === 'district' },
    { k: 'color', label: 'Custom fill', t: 'color' },
    GAP,
  ],
  cutout: [
    label('name'),
    { t: 'info', text: 'Removes this area from any district below it in the layer list: a hole, bay or notch cut out of the inside of a district. Move it above or below districts in Layers to choose what it cuts.' },
    { k: 'fill', label: 'Inside shows', t: 'select', options: [['none', 'Whatever is underneath'], ['street', 'Open ground (street color)'], ['park', 'Park']] },
    { k: 'gap', label: 'Gap around it', t: 'range', min: 0, max: 20, step: 0.5 },
    { k: 'smooth', label: 'Smooth edges', t: 'check' },
  ],
  landmark: [
    label('name'),
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'size', label: 'Dot size', t: 'range', min: 1, max: 30, step: 0.5 },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 6, max: 80, step: 1 },
    { k: 'halo', label: 'Label border', t: 'optrange', min: 0, max: 0.8, step: 0.01 },
    { t: 'info', text: 'Drag the label on the map to move it relative to the dot.' },
  ],
  label: [
    { k: 'text', label: 'Text', t: 'textarea' },
    { k: 'style', label: 'Style', t: 'select', options: Object.entries(LABEL_STYLES).map(([k, v]) => [k, v.name]) },
    { k: 'pathPos', label: 'Position along road', t: 'range', min: 0, max: 1, step: 0.005, show: (f) => !!f.pathId },
    { t: 'button', label: '⛓ Detach from road', help: 'Make this an ordinary free label again.', show: (f) => !!f.pathId, action: (f, ctx) => ctx.detachLabel(f) },
    { k: 'size', label: 'Size', t: 'range', min: 6, max: 240, step: 1 },
    { k: 'angle', label: 'Angle', t: 'range', min: -180, max: 180, step: 1 },
    { k: 'spacing', label: 'Letter spacing', t: 'range', min: 0, max: 2, step: 0.02 },
    { k: 'halo', label: 'Label border', t: 'optrange', min: 0, max: 0.8, step: 0.01 },
    { k: 'color', label: 'Custom color', t: 'color' },
  ],
  compass: [
    { k: 'size', label: 'Size', t: 'range', min: 20, max: 500, step: 1 },
    { k: 'angle', label: 'Rotation', t: 'range', min: -180, max: 180, step: 1 },
  ],
};

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
export { el };

// Collapsible section: a clickable heading plus a body you append to. Open/closed state is remembered.
const SECTION_KEY = 'citybuilder.sections';
let sectionState = {};
try { sectionState = JSON.parse(localStorage.getItem(SECTION_KEY) || '{}'); } catch (e) { sectionState = {}; }

export function collapsible(container, title, o = {}) {
  const key = o.key || title;
  const closed = key in sectionState ? sectionState[key] : !!o.collapsed;
  const chev = el('span', { class: 'chev' }, closed ? '▸' : '▾');
  const head = el('div', { class: 'heading collapsible' }, chev, ' ' + title);
  const body = el('div', { class: 'sec' + (closed ? ' hidden' : '') });
  head.addEventListener('click', () => {
    const nowClosed = !body.classList.contains('hidden');
    body.classList.toggle('hidden', nowClosed);
    chev.textContent = nowClosed ? '▸' : '▾';
    sectionState[key] = nowClosed;
    try { localStorage.setItem(SECTION_KEY, JSON.stringify(sectionState)); } catch (e) { /* ignore */ }
  });
  container.append(head, body);
  return body;
}

// fields: schema; obj: object being edited; h: { onInput, onCommit, rebuild, ctx, defaults }
export function buildForm(container, fields, obj, h) {
  let target = container;
  for (const fd of fields) {
    if (fd.show && !fd.show(obj)) continue;
    if (fd.t === 'heading') { target = collapsible(container, fd.label, { collapsed: fd.collapsed }); continue; }
    if (fd.t === 'info') { target.append(el('p', { class: 'info' }, fd.text)); continue; }
    if (fd.t === 'custom') { fd.render(target, obj, h); continue; }
    const row = el('label', { class: 'field' + (fd.t === 'check' ? ' check' : '') });
    row.append(el('span', {}, fd.label));
    const after = () => { if (fd.onChange) fd.onChange(obj, h.ctx); h.onCommit(); if (fd.rebuild) h.rebuild(); };
    let input;
    switch (fd.t) {
      case 'text':
        input = el('input', { type: 'text', value: obj[fd.k] ?? '' });
        input.addEventListener('input', () => { obj[fd.k] = input.value; h.onInput(); });
        input.addEventListener('change', after);
        break;
      case 'textarea':
        input = el('textarea', { rows: 2 });
        input.value = obj[fd.k] ?? '';
        input.addEventListener('input', () => { obj[fd.k] = input.value; h.onInput(); });
        input.addEventListener('change', after);
        break;
      case 'number':
        input = el('input', { type: 'number', value: obj[fd.k], min: fd.min, max: fd.max, step: fd.step || 1 });
        input.addEventListener('input', () => { const v = parseFloat(input.value); if (!isNaN(v)) { obj[fd.k] = v; h.onInput(); } });
        input.addEventListener('change', after);
        break;
      case 'range': {
        const wrap = el('div', { class: 'range' });
        const r = el('input', { type: 'range', min: fd.min, max: fd.max, step: fd.step || 1, value: obj[fd.k] });
        const num = el('input', { type: 'number', min: fd.min, max: fd.max, step: fd.step || 1, value: obj[fd.k] });
        r.addEventListener('input', () => { obj[fd.k] = parseFloat(r.value); num.value = r.value; if (fd.live && fd.onChange) fd.onChange(obj, h.ctx); h.onInput(); });
        r.addEventListener('change', after);
        num.addEventListener('input', () => { const v = parseFloat(num.value); if (!isNaN(v)) { obj[fd.k] = v; r.value = v; h.onInput(); } });
        num.addEventListener('change', after);
        wrap.append(r, num);
        input = wrap;
        break;
      }
      case 'optrange': {
        // A value that can be left on the map-wide default (null) or overridden for this item.
        const wrap = el('div', { class: 'optrange' });
        const auto = el('input', { type: 'checkbox', checked: obj[fd.k] == null });
        const fb = fd.fallback ? fd.fallback(h.ctx) : (h.ctx && h.ctx.haloDefault ? h.ctx.haloDefault() : 0.34);
        const r = el('input', { type: 'range', min: fd.min, max: fd.max, step: fd.step || 1, value: obj[fd.k] ?? fb });
        r.disabled = obj[fd.k] == null;
        auto.addEventListener('change', () => { r.disabled = auto.checked; obj[fd.k] = auto.checked ? null : parseFloat(r.value); after(); });
        r.addEventListener('input', () => { obj[fd.k] = parseFloat(r.value); h.onInput(); });
        r.addEventListener('change', after);
        wrap.append(r, el('label', { class: 'mini' }, auto, ' map default'));
        input = wrap;
        break;
      }
      case 'select': {
        const options = typeof fd.options === 'function' ? fd.options(obj, h.ctx) : fd.options;
        const sel = el('select', {}, ...options.map(([v, l]) => el('option', { value: v, selected: String(obj[fd.k] ?? '') === String(v) }, l)));
        sel.addEventListener('change', () => {
          const prev = obj[fd.k];
          obj[fd.k] = sel.value;
          if (fd.onChange) fd.onChange(obj, h.ctx, prev);
          h.onCommit();
          if (fd.rebuild) h.rebuild();
        });
        input = sel;
        break;
      }
      case 'button': {
        const b = el('button', { type: 'button', class: 'wide', title: fd.help || '' }, fd.label);
        b.addEventListener('click', (e) => { e.preventDefault(); fd.action(obj, h.ctx); });
        target.append(b);
        continue;
      }
      case 'check': {
        const cb = el('input', { type: 'checkbox', checked: !!obj[fd.k] });
        cb.addEventListener('change', () => { obj[fd.k] = cb.checked; after(); });
        row.prepend(cb);
        break;
      }
      case 'color': {
        const wrap = el('div', { class: 'color' });
        const dflt = (h.defaults && h.defaults(fd.k, obj)) || '#888888';
        const c = el('input', { type: 'color', value: obj[fd.k] || dflt });
        const state = el('small', {}, obj[fd.k] ? 'custom' : 'theme');
        const reset = el('button', { type: 'button', title: 'Use theme color' }, '×');
        c.addEventListener('input', () => { obj[fd.k] = c.value; state.textContent = 'custom'; h.onInput(); });
        c.addEventListener('change', after);
        reset.addEventListener('click', (e) => { e.preventDefault(); obj[fd.k] = ''; after(); h.rebuild(); });
        wrap.append(c, state, reset);
        input = wrap;
        break;
      }
      case 'seed': {
        const wrap = el('div', { class: 'seed' });
        const num = el('input', { type: 'number', value: obj[fd.k] });
        const btn = el('button', { type: 'button' }, '🎲 Reroll');
        num.addEventListener('change', () => { obj[fd.k] = parseInt(num.value, 10) || 1; after(); });
        btn.addEventListener('click', (e) => { e.preventDefault(); obj[fd.k] = Math.floor(Math.random() * 1e9); num.value = obj[fd.k]; after(); });
        wrap.append(num, btn);
        input = wrap;
        break;
      }
      default: break;
    }
    if (input) row.append(input);
    target.append(row);
  }
}
