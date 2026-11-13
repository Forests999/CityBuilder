// Property panels: a small schema-driven form builder.

import { PRESETS, PRESET_LABELS } from './generate.js';
import { LABEL_STYLES } from './render.js';

const opts = (o) => Object.entries(o);
const label = (k) => ({ k, label: 'Name', t: 'text' });

export const SCHEMAS = {
  wall: [
    label('name'),
    { k: 'width', label: 'Thickness', t: 'range', min: 1, max: 30, step: 0.5 },
    { k: 'towerSpacing', label: 'Tower spacing', t: 'range', min: 15, max: 300, step: 1 },
    { k: 'towerSize', label: 'Tower size', t: 'range', min: 0, max: 20, step: 0.5 },
    { k: 'cornerTowers', label: 'Towers at sharp corners', t: 'check' },
    { k: 'gates', label: 'Gates at roads', t: 'check' },
    { k: 'smooth', label: 'Smooth curve', t: 'check' },
  ],
  district: [
    label('name'),
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 160, step: 1 },
    { k: 'labelAngle', label: 'Label angle', t: 'range', min: -90, max: 90, step: 1 },
    { k: 'labelSpacing', label: 'Letter spacing', t: 'range', min: 0, max: 1.5, step: 0.05 },
    { t: 'heading', label: 'Streets' },
    { k: 'preset', label: 'Style preset', t: 'select', options: opts(PRESET_LABELS), rebuild: true,
      onChange: (f) => Object.assign(f, PRESETS[f.preset]) },
    { k: 'pattern', label: 'Pattern', t: 'select', options: [['organic', 'Organic'], ['radial', 'Radial / rings'], ['grid', 'Grid']], rebuild: true },
    { k: 'gridAngle', label: 'Grid angle', t: 'range', min: 0, max: 180, step: 1, show: (f) => f.pattern === 'grid' },
    { k: 'blockSize', label: 'Block size', t: 'range', min: 8, max: 400, step: 1 },
    { k: 'streetWidth', label: 'Street width', t: 'range', min: 0.5, max: 14, step: 0.1 },
    { k: 'irregularity', label: 'Irregularity', t: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'warp', label: 'Curviness', t: 'range', min: 0, max: 40, step: 0.5 },
    { k: 'lots', label: 'Building lots', t: 'check' },
    { k: 'courtyards', label: 'Open squares', t: 'range', min: 0, max: 0.6, step: 0.01 },
    { k: 'seed', label: 'Layout seed', t: 'seed' },
    { t: 'heading', label: 'Look' },
    { k: 'tone', label: 'Tone', t: 'select', options: [['normal', 'Normal'], ['dark', 'Dark (slums, industry)'], ['light', 'Light (wealthy)'], ['park', 'Park']] },
    { k: 'color', label: 'Custom fill', t: 'color' },
    { k: 'hatch', label: 'Hatching', t: 'check' },
    { k: 'borderStreet', label: 'Border street', t: 'range', min: 0, max: 20, step: 0.5 },
    { t: 'heading', label: 'Shape' },
    { k: 'followWall', label: 'Shape follows', t: 'select', rebuild: true, options: (f, ctx) => [['', 'Its own outline'], ...ctx.wallOptions()],
      onChange: (f, ctx, prev) => ctx.unlinkWall(f, prev) },
    { k: 'clipWall', label: 'Clip to wall', t: 'select', options: (f, ctx) => [['', 'Off'], ['all', 'Inside any wall'], ...ctx.wallOptions()] },
    { k: 'smooth', label: 'Smooth edges', t: 'check', show: (f) => !f.followWall },
    { t: 'heading', label: 'Tools' },
    { t: 'button', label: '✂ Split with a line', help: 'Draw a line across this district to break it into two.', action: (f, ctx) => ctx.startSplit(f) },
    { t: 'button', label: '🏰 Create wall around it', help: 'Adds a wall that traces this outline exactly and clips the district to it.', action: (f, ctx) => ctx.wallFromArea(f) },
  ],
  farm: [
    label('name'),
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 160, step: 1 },
    { k: 'labelAngle', label: 'Label angle', t: 'range', min: -90, max: 90, step: 1 },
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
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 160, step: 1 },
    { k: 'labelAngle', label: 'Label angle', t: 'range', min: -90, max: 90, step: 1 },
    { k: 'labelSpacing', label: 'Letter spacing', t: 'range', min: 0, max: 1.5, step: 0.05 },
    { k: 'coastLines', label: 'Coast lines', t: 'range', min: 0, max: 8, step: 1 },
    { k: 'smooth', label: 'Smooth shore', t: 'check' },
  ],
  river: [
    label('name'),
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 8, max: 120, step: 1 },
    { k: 'labelSpacing', label: 'Letter spacing', t: 'range', min: 0, max: 3, step: 0.05 },
    { k: 'labelPos', label: 'Label position', t: 'range', min: 0, max: 1, step: 0.005 },
    { k: 'width', label: 'Width', t: 'range', min: 3, max: 250, step: 1 },
    { k: 'wobble', label: 'Bank wobble', t: 'range', min: 0, max: 0.6, step: 0.01, show: (f) => !f.canal },
    { k: 'canal', label: 'Canal (stone-lined)', t: 'check', rebuild: true },
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
  ],
  plaza: [
    label('name'),
    { k: 'radius', label: 'Radius', t: 'range', min: 3, max: 200, step: 1 },
    { k: 'monument', label: 'Centerpiece', t: 'select', options: [['none', 'None'], ['dot', 'Statue (dot)'], ['ring', 'Ring'], ['fountain', 'Fountain'], ['obelisk', 'Obelisk'], ['tree', 'Tree / garden']] },
  ],
  building: [
    label('name'),
    { k: 'style', label: 'Fill', t: 'select', options: [['solid', 'Solid ink'], ['light', 'Light (street color)'], ['block', 'Block color'], ['accent', 'Accent'], ['park', 'Park'], ['water', 'Water']] },
    { k: 'smooth', label: 'Smooth edges', t: 'check' },
  ],
  landmark: [
    label('name'),
    { k: 'showLabel', label: 'Show label', t: 'check' },
    { k: 'size', label: 'Dot size', t: 'range', min: 1, max: 30, step: 0.5 },
    { k: 'labelSize', label: 'Label size', t: 'range', min: 6, max: 80, step: 1 },
    { t: 'info', text: 'Drag the label on the map to move it relative to the dot.' },
  ],
  label: [
    { k: 'text', label: 'Text', t: 'textarea' },
    { k: 'style', label: 'Style', t: 'select', options: Object.entries(LABEL_STYLES).map(([k, v]) => [k, v.name]) },
    { k: 'size', label: 'Size', t: 'range', min: 6, max: 240, step: 1 },
    { k: 'angle', label: 'Angle', t: 'range', min: -180, max: 180, step: 1 },
    { k: 'spacing', label: 'Letter spacing', t: 'range', min: 0, max: 2, step: 0.02 },
    { k: 'color', label: 'Custom color', t: 'color' },
  ],
  compass: [
    { k: 'size', label: 'Size', t: 'range', min: 20, max: 500, step: 1 },
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

// fields: schema; obj: object being edited; h: { onInput, onCommit, rebuild, ctx, defaults }
export function buildForm(container, fields, obj, h) {
  for (const fd of fields) {
    if (fd.show && !fd.show(obj)) continue;
    if (fd.t === 'heading') { container.append(el('div', { class: 'heading' }, fd.label)); continue; }
    if (fd.t === 'info') { container.append(el('p', { class: 'info' }, fd.text)); continue; }
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
        r.addEventListener('input', () => { obj[fd.k] = parseFloat(r.value); num.value = r.value; h.onInput(); });
        r.addEventListener('change', after);
        num.addEventListener('input', () => { const v = parseFloat(num.value); if (!isNaN(v)) { obj[fd.k] = v; r.value = v; h.onInput(); } });
        num.addEventListener('change', after);
        wrap.append(r, num);
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
        container.append(b);
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
    container.append(row);
  }
}
