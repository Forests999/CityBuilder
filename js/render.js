// Luthadel-style renderer: hatched red city, white streets, grey water, studded wall.
const W = 1600, H = 1200;
const STYLE = {
  paper: '#efe9d8', street: '#f6f1e4', ink: '#17130f', red: '#a3231a',
  hatchBg: '#8b3329', hatchLine: '#5e1f19', water: '#8d8d99', waterDark: '#2c2c36', field: '#b9b4a4',
};

function renderMap(s, gen) {
  const wallPath = G.polyPath(s.wall, true);
  const riverPaths = s.rivers.map((r) => ({ d: G.smoothPath(r.pts, false), w: r.width }));
  const streetCss = `stroke="${STYLE.street}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let o = '';

  o += `<defs>
    <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <rect width="5" height="5" fill="${STYLE.hatchBg}"/><line x1="0" y1="0" x2="0" y2="5" stroke="${STYLE.hatchLine}" stroke-width="2"/>
    </pattern>
    <clipPath id="wallClip"><path d="${wallPath}"/></clipPath>
    <mask id="riverMask">${riverPaths.map((r) => `<path d="${r.d}" stroke="#fff" stroke-width="${r.w + 10}" fill="none"/>`).join('')}</mask>
  </defs>`;

  o += `<rect width="${W}" height="${H}" fill="${STYLE.paper}"/>`;

  // countryside lines + roads leaving the gates
  for (const f of gen.fields) o += `<path d="${G.polyPath(f)}" stroke="${STYLE.field}" stroke-width="1.2" fill="none"/>`;
  for (const l of gen.outside) o += `<path d="${G.polyPath(l)}" stroke="${STYLE.ink}" stroke-width="1.6" fill="none" opacity=".55"/>`;

  // city body
  o += `<path d="${wallPath}" fill="url(#hatch)"/>`;
  o += `<g clip-path="url(#wallClip)">`;
  for (const st of gen.streets) o += `<path d="${G.polyPath([st.a, st.b])}" stroke-width="${st.w}" ${streetCss}/>`;
  for (const r of gen.ringLines) o += `<path d="${G.polyPath(r.pts, true)}" stroke-width="${r.w}" ${streetCss}/>`;
  for (const sp of gen.spokes) o += `<path d="${G.polyPath([sp.from, sp.to])}" stroke-width="${sp.w}" ${streetCss}/>`;
  o += `</g>`;

  // wall: solid line + round towers
  o += `<path d="${wallPath}" fill="none" stroke="${STYLE.ink}" stroke-width="6" stroke-linejoin="round"/>`;
  o += `<path d="${wallPath}" fill="none" stroke="${STYLE.ink}" stroke-width="12" stroke-dasharray="0 16" stroke-linecap="round"/>`;

  // gates
  for (const g of gen.gates) {
    const dx = Math.cos(g.a) * 16, dy = Math.sin(g.a) * 16;
    const seg = `M${g.p.x - dx},${g.p.y - dy}L${g.p.x + dx},${g.p.y + dy}`;
    o += `<path d="${seg}" stroke="${STYLE.ink}" stroke-width="18" stroke-linecap="butt"/>`;
    o += `<path d="${seg}" stroke="${STYLE.street}" stroke-width="10" stroke-linecap="butt"/>`;
  }

  // rivers (cover streets and wall), then bridges drawn over them
  for (const r of riverPaths) {
    o += `<path d="${r.d}" stroke="${STYLE.waterDark}" stroke-width="${r.w + 8}" fill="none" stroke-linejoin="round"/>`;
    o += `<path d="${r.d}" stroke="${STYLE.water}" stroke-width="${r.w}" fill="none" stroke-linejoin="round"/>`;
    o += `<path d="${r.d}" stroke="#5f5f6c" stroke-width="1.6" fill="none" stroke-dasharray="26 12"/>`;
  }
  o += `<g mask="url(#riverMask)" clip-path="url(#wallClip)">`;
  for (const sp of gen.spokes) {
    const seg = G.polyPath([sp.from, sp.to]);
    o += `<path d="${seg}" stroke="${STYLE.ink}" stroke-width="${sp.w + 5}" fill="none"/>`;
    o += `<path d="${seg}" stroke-width="${sp.w}" ${streetCss}/>`;
  }
  for (const r of gen.ringLines) {
    o += `<path d="${G.polyPath(r.pts, true)}" stroke="${STYLE.ink}" stroke-width="${r.w + 5}" fill="none"/>`;
    o += `<path d="${G.polyPath(r.pts, true)}" stroke-width="${r.w}" ${streetCss}/>`;
  }
  o += `</g>`;

  // central landmark
  const c = s.center;
  o += `<circle cx="${c.x}" cy="${c.y}" r="26" fill="${STYLE.street}" stroke="${STYLE.ink}" stroke-width="3"/>`;
  o += `<circle cx="${c.x}" cy="${c.y}" r="14" fill="${STYLE.red}"/><circle cx="${c.x}" cy="${c.y}" r="6" fill="${STYLE.street}"/>`;

  // gate labels
  for (const g of gen.gates) {
    let deg = (g.a * 180) / Math.PI, anchor = 'start', off = 30;
    if (Math.cos(g.a) < 0) { deg += 180; anchor = 'end'; }
    const px = g.p.x + Math.cos(g.a) * off, py = g.p.y + Math.sin(g.a) * off;
    o += `<text transform="translate(${px.toFixed(1)},${py.toFixed(1)}) rotate(${deg.toFixed(1)})" text-anchor="${anchor}" dominant-baseline="middle"
      font-family="Georgia,serif" font-size="17" letter-spacing="3" fill="${STYLE.red}">${g.name.toUpperCase()}</text>`;
  }

  // title cartouche
  const tw = 60 + s.title.length * 42;
  o += `<rect x="50" y="50" width="${tw}" height="112" fill="${STYLE.paper}" stroke="${STYLE.ink}" stroke-width="6"/>`;
  o += `<rect x="62" y="62" width="${tw - 24}" height="88" fill="none" stroke="${STYLE.ink}" stroke-width="2"/>`;
  o += `<text x="${50 + tw / 2}" y="123" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="58" letter-spacing="8" fill="${STYLE.red}">${escapeXml(s.title)}</text>`;

  // compass medallion
  const mx = 1440, my = 1040;
  o += `<circle cx="${mx}" cy="${my}" r="74" fill="${STYLE.paper}" stroke="${STYLE.ink}" stroke-width="7"/>`;
  o += `<circle cx="${mx}" cy="${my}" r="60" fill="none" stroke="${STYLE.ink}" stroke-width="2"/>`;
  o += `<circle cx="${mx}" cy="${my}" r="34" fill="none" stroke="${STYLE.ink}" stroke-width="2"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    o += `<path d="M${mx},${my}L${mx + Math.cos(a) * 60},${my + Math.sin(a) * 60}" stroke="${STYLE.ink}" stroke-width="${i % 2 ? 1.2 : 2.4}"/>`;
  }
  o += `<path d="M${mx},${my - 74}l8,-18h-16z" fill="${STYLE.red}"/>`;

  // frame: heavy black border with white tick marks
  o += `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${STYLE.ink}" stroke-width="22"/>`;
  o += `<rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${STYLE.paper}" stroke-width="12" stroke-dasharray="2 6" opacity=".85"/>`;

  return o;
}

function escapeXml(t) {
  return t.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
