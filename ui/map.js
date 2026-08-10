const WASTE_COLOR = '#23262d';
const GRID_LINE = 'rgba(20,23,28,0.55)';
const NATION_PALETTE = [
  '#c9a15a', '#6f9a8d', '#b3543f', '#7c8fc9', '#a9c96a', '#c97fb0',
  '#4c8c94', '#d0975a', '#8f7ec9', '#7fb0c9', '#e0c070', '#9fd0b0',
];

export function makeNationColorMap(nations) {
  const map = new Map();
  [...nations.keys()].forEach((id, i) => map.set(id, NATION_PALETTE[i % NATION_PALETTE.length]));
  return map;
}

export function initMap(canvas, game, onSelect) {
  const ctx = canvas.getContext('2d');
  const state = { hover: null, scale: 1, offX: 0, offY: 0 };

  function cellSize() {
    const { cols, rows } = game.world;
    return Math.floor(Math.min(canvas.width / cols, canvas.height / rows));
  }

  function cellAt(px, py) {
    const cs = cellSize();
    const { cols, rows } = game.world;
    const totalW = cs * cols, totalH = cs * rows;
    const ox = (canvas.width - totalW) / 2, oy = (canvas.height - totalH) / 2;
    const x = Math.floor((px - ox) / cs), y = Math.floor((py - oy) / cs);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return game.world.grid[y][x];
  }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    state.hover = cellAt(px, py);
  });
  canvas.addEventListener('mouseleave', () => { state.hover = null; });
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const id = cellAt(px, py);
    if (id) onSelect(id);
  });

  return { ctx, state, cellSize };
}

export function drawMap(canvas, ctx, game, mapHandle, nationColors) {
  const { cols, rows } = game.world;
  const cs = mapHandle.cellSize();
  const totalW = cs * cols, totalH = cs * rows;
  const ox = Math.floor((canvas.width - totalW) / 2), oy = Math.floor((canvas.height - totalH) / 2);

  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const id = game.world.grid[y][x];
      const p = game.world.provinces.get(id);
      ctx.fillStyle = colorForProvince(p, game, mapHandle, nationColors);
      const px = ox + x * cs, py = oy + y * cs;
      ctx.fillRect(px, py, cs, cs);
    }
  }

  // grid lines
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath(); ctx.moveTo(ox + x * cs + 0.5, oy); ctx.lineTo(ox + x * cs + 0.5, oy + totalH); ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath(); ctx.moveTo(ox, oy + y * cs + 0.5); ctx.lineTo(ox + totalW, oy + y * cs + 0.5); ctx.stroke();
  }

  // capitals
  ctx.fillStyle = '#f4efe0';
  for (const c of game.countries.values()) {
    if (!c.capitalProvinceId) continue;
    const p = game.world.provinces.get(c.capitalProvinceId);
    const px = ox + p.x * cs + cs / 2, py = oy + p.y * cs + cs / 2;
    ctx.beginPath(); ctx.arc(px, py, Math.max(2, cs * 0.18), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0f1115'; ctx.lineWidth = 1; ctx.stroke();
  }

  // selection highlight
  if (game.selected && game.selected.type === 'province') {
    const p = game.world.provinces.get(game.selected.id);
    if (p) {
      ctx.strokeStyle = '#f4efe0'; ctx.lineWidth = 2;
      ctx.strokeRect(ox + p.x * cs + 1, oy + p.y * cs + 1, cs - 2, cs - 2);
    }
  }
  // hover highlight
  if (mapHandle.state.hover) {
    const p = game.world.provinces.get(mapHandle.state.hover);
    ctx.strokeStyle = 'rgba(244,239,224,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(ox + p.x * cs + 0.5, oy + p.y * cs + 0.5, cs - 1, cs - 1);
  }

  return { ox, oy, cs };
}

function colorForProvince(p, game, mapHandle, nationColors) {
  if (p.habitability !== 'Settled') return WASTE_COLOR;
  const mode = game.mapMode;
  if (mode === 'political') {
    if (!p.ownerCountryId) return '#3a3f47';
    return game.countries.get(p.ownerCountryId).color;
  }
  if (mode === 'national') {
    if (!p.ownerCountryId) return '#3a3f47';
    const c = game.countries.get(p.ownerCountryId);
    const dominant = Object.entries(c.nationShares).sort((a, b) => b[1] - a[1])[0];
    return dominant ? nationColors.get(dominant[0]) : '#3a3f47';
  }
  if (mode === 'economic') {
    const d = p.developmentLevel;
    return devColor(d);
  }
  return '#3a3f47';
}

function devColor(d) {
  // dark ink -> muted gold heat scale
  const stops = [
    [0.00, [35, 40, 46]],
    [0.35, [70, 74, 56]],
    [0.65, [140, 120, 70]],
    [1.00, [222, 178, 92]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (d >= t0 && d <= t1) {
      const t = (d - t0) / (t1 - t0);
      const c = c0.map((v, i2) => Math.round(v + (c1[i2] - v) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`;
}
