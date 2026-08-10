import { makeRng } from './core.js';
import { generateWorld } from './world/worldgen.js';
import { generateCountries } from './world/countries.js';
import { runTick } from './sim.js';
import { initMap, drawMap, makeNationColorMap } from './ui/map.js';
import {
  renderEmpireTab, renderWorldTab, renderDiplomacyTab, renderDebugTab,
  renderDataEditorTab, renderInspector, playerCountry,
} from './ui/panels.js';
import { renderActionsTab } from './ui/actions.js';
import { getEditableTables, applyTableEdits } from './data.js';

let game = null;
let nationColors = null;
let mapHandle = null;
let devMode = false;
let autoplay = null;

const canvas = document.getElementById('mapCanvas');
const panes = {
  map: document.getElementById('pane-map'),
  empire: document.getElementById('pane-empire'),
  actions: document.getElementById('pane-actions'),
  world: document.getElementById('pane-world'),
  diplomacy: document.getElementById('pane-diplomacy'),
  data: document.getElementById('pane-data'),
  debug: document.getElementById('pane-debug'),
};
const inspectorEl = document.getElementById('inspector');
let activeTab = 'map';

function buildWorld(seed) {
  const rng = makeRng(seed);
  const world = generateWorld(rng);
  const { countries, nations, relations, sharedNationId } = generateCountries(rng, world);
  game = {
    tick: 0, world, countries, nations, relations, sharedNationId,
    mapMode: 'political', selected: null, eventLog: [{ tick: 0, text: 'World generated.' }],
  };
  nationColors = makeNationColorMap(nations);
  const player = playerCountry(game);
  game.selected = { type: 'country', id: player.id };
  resizeCanvas();
  mapHandle = initMap(canvas, game, onSelectProvince);
  renderAll();
}

function onSelectProvince(id) {
  game.selected = { type: 'province', id };
  renderAll();
}
function onSelectCountry(id) {
  game.selected = { type: 'country', id };
  renderAll();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(200, Math.floor(rect.width * dpr));
  canvas.height = Math.max(200, Math.floor(rect.height * dpr));
}

function renderMap() {
  if (activeTab !== 'map') return;
  const ctx = mapHandle.ctx;
  drawMap(canvas, ctx, game, mapHandle, nationColors);
  const legend = document.getElementById('mapLegend');
  legend.innerHTML = legendHtml(game.mapMode);
}

function legendHtml(mode) {
  if (mode === 'political') {
    return [...game.countries.values()].map(c =>
      `<span><span class="dot" style="background:${c.color}"></span>${c.name}</span>`).join('');
  }
  if (mode === 'national') {
    return [...game.nations.entries()].slice(0, 8).map(([id, n]) =>
      `<span><span class="dot" style="background:${nationColors.get(id)}"></span>${n.name}</span>`).join('');
  }
  return `<span><span class="dot" style="background:#28303a"></span>low development</span>
          <span><span class="dot" style="background:#deb25c"></span>high development</span>`;
}

function renderAll() {
  document.getElementById('tickValue').textContent = game.tick;
  if (activeTab === 'map') renderMap();
  if (activeTab === 'empire') renderEmpireTab(panes.empire, game);
  if (activeTab === 'actions') renderActionsTab(panes.actions, game, renderAll);
  if (activeTab === 'world') renderWorldTab(panes.world, game, onSelectCountry);
  if (activeTab === 'diplomacy') renderDiplomacyTab(panes.diplomacy, game);
  if (activeTab === 'debug') renderDebugTab(panes.debug, game);
  renderInspector(inspectorEl, game, devMode);
}

// ---------------------------------------------------------------- tab wiring
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  Object.entries(panes).forEach(([key, el]) => el.classList.toggle('hidden', key !== btn.dataset.tab));
  activeTab = btn.dataset.tab;
  if (activeTab === 'data') {
    renderDataEditorTab(panes.data, getEditableTables(), (parsed) => {
      applyTableEdits(parsed);
      buildWorld(Date.now() % 1e9);
    });
  }
  if (activeTab === 'map') resizeCanvas();
  renderAll();
});

document.getElementById('mapModeSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  game.mapMode = btn.dataset.mode;
  renderMap();
});

document.getElementById('btnTick').addEventListener('click', () => {
  runTick(game);
  renderAll();
});
document.getElementById('btnAuto').addEventListener('click', (e) => {
  if (autoplay) {
    clearInterval(autoplay); autoplay = null; e.target.classList.remove('active'); e.target.textContent = 'Auto-play ▸▸';
  } else {
    autoplay = setInterval(() => { runTick(game); renderAll(); }, 900);
    e.target.classList.add('active'); e.target.textContent = 'Stop autoplay ■';
  }
});
document.getElementById('devMode').addEventListener('change', (e) => {
  devMode = e.target.checked;
  renderAll();
});
window.addEventListener('resize', () => { if (activeTab === 'map') { resizeCanvas(); renderMap(); } });

// ------------------------------------------------------------------- go!
buildWorld(20260811);
