// UI + editing. State lives in `state`; every change re-runs generateCity + renderMap.
const KEY = 'citybuilder.v1';
let state = load() || defaultState();
let selRiver = 0;
let drag = null;
let showHandles = true;

const svg = document.getElementById('map');
svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function overlay() {
  if (!showHandles) return '';
  let o = '<g id="overlay">';
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const w = state.wall;
  w.forEach((p, i) => {
    const m = mid(p, w[(i + 1) % w.length]);
    o += `<circle class="h mid" data-k="mid" data-t="wall" data-i="${i}" cx="${m.x}" cy="${m.y}" r="6"/>`;
  });
  w.forEach((p, i) => (o += `<circle class="h wall" data-k="wall" data-i="${i}" cx="${p.x}" cy="${p.y}" r="9"/>`));
  state.rivers.forEach((r, ri) => {
    r.pts.slice(0, -1).forEach((p, i) => {
      const m = mid(p, r.pts[i + 1]);
      o += `<circle class="h mid" data-k="mid" data-t="river" data-r="${ri}" data-i="${i}" cx="${m.x}" cy="${m.y}" r="6"/>`;
    });
    r.pts.forEach((p, i) => (o += `<circle class="h river${ri === selRiver ? ' sel' : ''}" data-k="river" data-r="${ri}" data-i="${i}" cx="${p.x}" cy="${p.y}" r="9"/>`));
  });
  const c = state.center;
  o += `<rect class="h center" data-k="center" x="${c.x - 11}" y="${c.y - 11}" width="22" height="22" transform="rotate(45 ${c.x} ${c.y})"/>`;
  return o + '</g>';
}

let pending = false;
function render() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    svg.innerHTML = renderMap(state, generateCity(state)) + overlay();
  });
}

function toSvg(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

svg.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('[data-k]');
  if (!t) return;
  let k = t.dataset.k, i = +t.dataset.i, r = +(t.dataset.r || 0);
  if (k === 'mid') {
    const p = toSvg(e);
    if (t.dataset.t === 'wall') { state.wall.splice(i + 1, 0, p); k = 'wall'; }
    else { state.rivers[r].pts.splice(i + 1, 0, p); k = 'river'; }
    i += 1;
  }
  if (k === 'river') selRiver = r, syncControls();
  drag = { k, i, r };
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
  render();
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toSvg(e);
  if (drag.k === 'wall') state.wall[drag.i] = p;
  else if (drag.k === 'river') state.rivers[drag.r].pts[drag.i] = p;
  else state.center = p;
  render();
});
svg.addEventListener('pointerup', () => { if (drag) { drag = null; save(); } });
svg.addEventListener('dblclick', (e) => {
  const t = e.target.closest('[data-k]');
  if (!t) return;
  const i = +t.dataset.i, r = +(t.dataset.r || 0);
  if (t.dataset.k === 'wall' && state.wall.length > 4) state.wall.splice(i, 1);
  else if (t.dataset.k === 'river' && state.rivers[r].pts.length > 2) state.rivers[r].pts.splice(i, 1);
  save(); render();
});

// ---- controls ----
const $ = (id) => document.getElementById(id);
function bindRange(id, get, set, label) {
  const el = $(id);
  el.addEventListener('input', () => { set(+el.value); if (label) $(label).textContent = el.value; save(); render(); });
}
function syncControls() {
  $('title').value = state.title;
  $('seed').value = state.seed;
  [['spokes', state.spokes], ['rings', state.rings], ['density', state.density],
    ['rwidth', state.rivers[selRiver] ? state.rivers[selRiver].width : 40]].forEach(([id, v]) => {
    $(id).value = v; $(id + 'v').textContent = v;
  });
  $('riverlabel').textContent = state.rivers.length ? `River ${selRiver + 1} of ${state.rivers.length}` : 'No rivers';
}

$('title').addEventListener('input', (e) => { state.title = e.target.value.toUpperCase(); save(); render(); });
$('seed').addEventListener('input', (e) => { state.seed = +e.target.value || 0; save(); render(); });
$('reroll').onclick = () => { state.seed = Math.floor(Math.random() * 9999); syncControls(); save(); render(); };
bindRange('spokes', 0, (v) => (state.spokes = v), 'spokesv');
bindRange('rings', 0, (v) => (state.rings = v), 'ringsv');
bindRange('density', 0, (v) => (state.density = v), 'densityv');
bindRange('rwidth', 0, (v) => { if (state.rivers[selRiver]) state.rivers[selRiver].width = v; }, 'rwidthv');
$('handles').onchange = (e) => { showHandles = e.target.checked; render(); };
$('addriver').onclick = () => {
  const y = 200 + state.rivers.length * 120;
  state.rivers.push({ width: 30, pts: [{ x: -60, y }, { x: 500, y: y + 60 }, { x: 1000, y: y - 40 }, { x: 1660, y: y + 40 }] });
  selRiver = state.rivers.length - 1; syncControls(); save(); render();
};
$('delriver').onclick = () => {
  if (!state.rivers.length) return;
  state.rivers.splice(selRiver, 1); selRiver = Math.max(0, selRiver - 1); syncControls(); save(); render();
};
$('nextriver').onclick = () => { if (state.rivers.length) { selRiver = (selRiver + 1) % state.rivers.length; syncControls(); render(); } };
$('reset').onclick = () => { if (confirm('Reset the map to the default city?')) { state = defaultState(); selRiver = 0; syncControls(); save(); render(); } };

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function svgString() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${renderMap(state, generateCity(state))}</svg>`;
}
$('exsvg').onclick = () => download(state.title.toLowerCase() + '.svg', new Blob([svgString()], { type: 'image/svg+xml' }));
$('expng').onclick = () => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => download(state.title.toLowerCase() + '.png', b));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString());
};
$('exjson').onclick = () => download(state.title.toLowerCase() + '.city.json', new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
$('imjson').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then((t) => { state = JSON.parse(t); selRiver = 0; syncControls(); save(); render(); });
};

syncControls();
render();
