import { currentStanding } from '../core.js';
import { RESOURCES, SPECIALIZATIONS, ESTATE_DEFS, BALANCE } from '../data.js';
import { relKey } from '../world/countries.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const sgn = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ---------------------------------------------------------------- Empire tab
export function renderEmpireTab(container, game) {
  const player = playerCountry(game);
  container.innerHTML = '';
  container.appendChild(el('div', 'panel-title', `${player.name} <span class="tag">${specName(player.specialization)}</span>`));

  const grid = el('div', 'stat-grid');
  grid.appendChild(statCard('Provinces held', player.territoryProvinceIds.length));
  grid.appendChild(statCard('Prestige', pct(player.standing.prestige)));
  grid.appendChild(statCard('Government', triangleLabel(player.government.triangle)));
  grid.appendChild(statCard('Rule style', player.government.institutionalPersonalistic >= 0 ? 'Institutional' : 'Personalistic'));
  container.appendChild(grid);

  container.appendChild(el('div', 'section-label', 'Estates — Loyalty & Rights'));
  const estWrap = el('div', 'estate-list');
  for (const def of ESTATE_DEFS) {
    const est = player.estates[def.key];
    const loy = currentStanding(est.loyalty, game.tick);
    const row = el('div', 'estate-row');
    row.appendChild(el('div', 'estate-name', `${def.name}${est.vetoTier !== 'none' ? ` <span class="veto">${est.vetoTier} veto</span>` : ''}`));
    row.appendChild(bar(loy, -1, 1, loy >= 0 ? 'bar-good' : 'bar-bad'));
    row.appendChild(el('div', 'estate-meta', `loyalty ${sgn(loy)} · rights ${pct(est.rights)} · control: ${est.controlDomain || '—'}`));
    estWrap.appendChild(row);
  }
  container.appendChild(estWrap);

  container.appendChild(el('div', 'section-label', 'Stockpile'));
  const stockWrap = el('div', 'resource-grid');
  for (const r of RESOURCES) {
    const amt = player.resourceStock[r.key] || 0;
    if (amt < 0.01 && r.tier !== 'Raw') continue;
    stockWrap.appendChild(el('div', 'resource-pill', `<b>${amt.toFixed(0)}</b> ${r.key}`));
  }
  container.appendChild(stockWrap);

  const upkeepNote = el('div', 'callout',
    `Administrative strain scales with size: at ${player.territoryProvinceIds.length} provinces your Estates lose roughly ` +
    `${(Math.pow(player.territoryProvinceIds.length / 25, BALANCE.SIZE_UPKEEP_EXPONENT) * 0.01 * 100).toFixed(2)}% loyalty baseline per tick before any policy offsets it. ` +
    `The bigger the realm, the harder it is to hold together — cooperation costs less than conquest.`);
  container.appendChild(upkeepNote);
}

// ----------------------------------------------------------------- World tab
export function renderWorldTab(container, game, onSelectCountry) {
  container.innerHTML = '';
  container.appendChild(el('div', 'panel-title', 'The Ten Realms'));
  const list = el('div', 'country-list');
  for (const c of game.countries.values()) {
    const row = el('div', `country-row ${game.selected.type === 'country' && game.selected.id === c.id ? 'selected' : ''}`);
    row.style.borderLeftColor = c.color;
    row.innerHTML = `
      <div class="country-row-head">
        <span class="swatch" style="background:${c.color}"></span>
        <b>${c.name}</b> ${c.isPlayer ? '<span class="tag">you</span>' : ''}
        <span class="tag">${specName(c.specialization)}</span>
      </div>
      <div class="country-row-meta">${c.territoryProvinceIds.length} provinces · prestige ${pct(c.standing.prestige)}</div>`;
    row.addEventListener('click', () => onSelectCountry(c.id));
    list.appendChild(row);
  }
  container.appendChild(list);
}

// ------------------------------------------------------------- Diplomacy tab
export function renderDiplomacyTab(container, game) {
  const player = playerCountry(game);
  container.innerHTML = '';
  container.appendChild(el('div', 'panel-title', 'Diplomatic Standing'));
  container.appendChild(el('div', 'callout',
    `All realms remain at peace during Phase I (Expansion). Claims and casus belli are recorded ` +
    `but dormant — war and treaty ratification arrive in later phases of the design.`));

  const table = el('div', 'diplo-table');
  for (const c of game.countries.values()) {
    if (c.id === player.id) continue;
    const rel = game.relations.get(relKey(player.id, c.id));
    const opinion = currentStanding(rel.opinion, game.tick);
    const myClaims = rel.claims.filter(cl => cl.claimantCountryId === player.id);
    const theirClaims = rel.claims.filter(cl => cl.claimantCountryId === c.id);
    const myCB = rel.casusBelli.filter(cb => cb.holderCountryId === player.id);
    const theirCB = rel.casusBelli.filter(cb => cb.holderCountryId === c.id);
    const row = el('div', 'diplo-row');
    row.innerHTML = `
      <div class="diplo-head"><span class="swatch" style="background:${c.color}"></span><b>${c.name}</b>
        <span class="tag">${rel.status}</span></div>
      <div class="diplo-meta">opinion ${sgn(opinion)}</div>
      ${myClaims.length ? `<div class="diplo-line">You claim: ${myClaims.map(cl => provName(game, cl.targetProvinceId)).join(', ')}</div>` : ''}
      ${theirClaims.length ? `<div class="diplo-line dim">They claim: ${theirClaims.map(cl => provName(game, cl.targetProvinceId)).join(', ')}</div>` : ''}
      ${myCB.length ? `<div class="diplo-line cb">You hold CB: ${myCB.map(cb => cb.triggerType).join(', ')}</div>` : ''}
      ${theirCB.length ? `<div class="diplo-line cb dim">They hold CB on you: ${theirCB.map(cb => cb.triggerType).join(', ')}</div>` : ''}
    `;
    table.appendChild(row);
  }
  container.appendChild(table);

  const shared = game.nations.get(game.sharedNationId);
  const hosts = [...game.countries.values()].filter(c => c.nationShares[game.sharedNationId]);
  container.appendChild(el('div', 'section-label', 'Nationalism watch'));
  container.appendChild(el('div', 'callout',
    `<b>${shared.name}</b> is split across ${hosts.length} realms: ` +
    hosts.map(c => `${c.name} (${pct(c.nationShares[game.sharedNationId])})`).join(', ') +
    `. Wherever it sits as a minority, irredentist pressure builds against the status quo.`));
}

// ---------------------------------------------------------------- Debug tab
export function renderDebugTab(container, game) {
  container.innerHTML = '';
  container.appendChild(el('div', 'panel-title', 'Developer Console'));
  const grid = el('div', 'stat-grid');
  grid.appendChild(statCard('Tick', game.tick));
  grid.appendChild(statCard('Provinces', game.world.provinces.size));
  grid.appendChild(statCard('Settled', [...game.world.provinces.values()].filter(p => p.habitability === 'Settled').length));
  grid.appendChild(statCard('Countries', game.countries.size));
  container.appendChild(grid);

  container.appendChild(el('div', 'section-label', 'Event log'));
  const log = el('div', 'event-log');
  for (const e of game.eventLog.slice(0, 40)) log.appendChild(el('div', 'event-line', `[${e.tick}] ${e.text}`));
  container.appendChild(log);

  container.appendChild(el('div', 'section-label', 'Selected entity — raw state'));
  const dump = el('pre', 'json-dump', JSON.stringify(selectedRaw(game), replacer, 2));
  container.appendChild(dump);
}

function replacer(key, value) {
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}
function selectedRaw(game) {
  if (!game.selected) return null;
  if (game.selected.type === 'province') return game.world.provinces.get(game.selected.id);
  if (game.selected.type === 'country') return game.countries.get(game.selected.id);
  return null;
}

// ------------------------------------------------------------------ Inspector
export function renderInspector(container, game, devMode) {
  container.innerHTML = '';
  if (!game.selected) {
    container.appendChild(el('div', 'panel-title', 'Inspector'));
    container.appendChild(el('div', 'callout', 'Click a province on the map, or a realm in the World tab, to inspect it here.'));
    return;
  }
  if (game.selected.type === 'province') return renderProvinceInspector(container, game, devMode);
  if (game.selected.type === 'country') return renderCountryInspector(container, game, devMode);
}

function renderProvinceInspector(container, game, devMode) {
  const p = game.world.provinces.get(game.selected.id);
  container.appendChild(el('div', 'panel-title', `Province ${indexOfProvince(game, p.id)}`));
  container.appendChild(el('div', 'callout',
    `${p.habitability}${p.ownerCountryId ? ` · owned by ${game.countries.get(p.ownerCountryId).name}` : ' · unclaimed'}`));
  if (p.habitability === 'Settled') {
    const grid = el('div', 'stat-grid');
    grid.appendChild(statCard('Development', pct(p.developmentLevel)));
    grid.appendChild(statCard('Fortification', pct(p.fortificationLevel)));
    container.appendChild(grid);
    container.appendChild(el('div', 'section-label', 'Resource yields'));
    const rw = el('div', 'resource-grid');
    for (const [res, amt] of Object.entries(p.rawResourceYields)) rw.appendChild(el('div', 'resource-pill', `<b>${amt}</b> ${res}`));
    container.appendChild(rw);
  }
  if (devMode) {
    container.appendChild(el('div', 'section-label', 'Dev: terrain axes'));
    const rw = el('div', 'resource-grid');
    for (const [axis, v] of Object.entries(p.terrain)) rw.appendChild(el('div', 'resource-pill', `<b>${v.toFixed(2)}</b> ${axis}`));
    container.appendChild(rw);
    container.appendChild(el('pre', 'json-dump', JSON.stringify(p, null, 2)));
  }
}

function renderCountryInspector(container, game, devMode) {
  const c = game.countries.get(game.selected.id);
  container.appendChild(el('div', 'panel-title', `${c.name} ${c.isPlayer ? '<span class="tag">you</span>' : ''}`));
  container.appendChild(el('div', 'callout', `${specName(c.specialization)} specialization · ${c.territoryProvinceIds.length} provinces · capital ${indexOfProvince(game, c.capitalProvinceId)}`));

  container.appendChild(el('div', 'section-label', 'Population — nations present'));
  const nw = el('div', 'resource-grid');
  for (const [nid, share] of Object.entries(c.nationShares).sort((a, b) => b[1] - a[1])) {
    const nation = game.nations.get(nid);
    const isShared = nid === game.sharedNationId;
    nw.appendChild(el('div', `resource-pill ${isShared ? 'shared-nation' : ''}`, `<b>${pct(share)}</b> ${nation.name}${nid === c.titularNationId ? ' (titular)' : ''}`));
  }
  container.appendChild(nw);

  container.appendChild(el('div', 'section-label', 'Estates'));
  const estWrap = el('div', 'estate-list');
  for (const def of ESTATE_DEFS) {
    const est = c.estates[def.key];
    const loy = currentStanding(est.loyalty, game.tick);
    const row = el('div', 'estate-row');
    row.appendChild(el('div', 'estate-name', def.name));
    row.appendChild(bar(devMode ? loy : Math.round(loy * 4) / 4, -1, 1, loy >= 0 ? 'bar-good' : 'bar-bad'));
    if (devMode) row.appendChild(el('div', 'estate-meta', `structural ${sgn(est.loyalty.structuralBaseline)} · modifiers ${est.loyalty.modifiers.length} · current ${sgn(loy)}`));
    estWrap.appendChild(row);
  }
  container.appendChild(estWrap);

  if (devMode) container.appendChild(el('pre', 'json-dump', JSON.stringify(c, replacer, 2)));
}

// ------------------------------------------------------------- Data editor tab
export function renderDataEditorTab(container, tables, onApply) {
  container.innerHTML = '';
  container.appendChild(el('div', 'panel-title', 'Game Data Editor'));
  container.appendChild(el('div', 'callout',
    `Every table below drives world generation and simulation — nothing is hardcoded into the ` +
    `logic. Edit the JSON and regenerate to see the effect immediately. Regenerating creates a ` +
    `brand new world from tick 0.`));

  const areas = {};
  for (const [label, obj] of Object.entries(tables)) {
    container.appendChild(el('div', 'section-label', label));
    const ta = el('textarea', 'data-editor-area');
    ta.value = JSON.stringify(obj, null, 2);
    ta.spellcheck = false;
    areas[label] = ta;
    container.appendChild(ta);
  }

  const status = el('div', 'callout dim', 'No changes applied yet.');
  const btn = el('button', 'btn-primary', 'Apply & Regenerate World');
  btn.addEventListener('click', () => {
    try {
      const parsed = {};
      for (const [label, ta] of Object.entries(areas)) parsed[label] = JSON.parse(ta.value);
      onApply(parsed);
      status.textContent = 'Applied — world regenerated from these tables.';
      status.className = 'callout';
    } catch (err) {
      status.textContent = `Could not apply: ${err.message}`;
      status.className = 'callout bar-bad-text';
    }
  });
  container.appendChild(btn);
  container.appendChild(status);
}

// ------------------------------------------------------------------- helpers
function statCard(label, value) {
  const c = el('div', 'stat-card');
  c.appendChild(el('div', 'stat-value', String(value)));
  c.appendChild(el('div', 'stat-label', label));
  return c;
}
function bar(value, lo, hi, cls) {
  const wrap = el('div', 'bar-wrap');
  const inner = el('div', `bar-inner ${cls}`);
  const t = (value - lo) / (hi - lo);
  inner.style.width = `${Math.round(t * 100)}%`;
  wrap.appendChild(inner);
  return wrap;
}
function specName(key) { return SPECIALIZATIONS.find(s => s.key === key)?.name || key; }
function triangleLabel(tri) {
  const entries = Object.entries(tri).sort((a, b) => b[1] - a[1]);
  return `${cap(entries[0][0])}-leaning`;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function provName(game, id) {
  const p = game.world.provinces.get(id);
  return `#${indexOfProvince(game, id)}${p.ownerCountryId ? '' : ' (unclaimed)'}`;
}
function indexOfProvince(game, id) {
  const p = game.world.provinces.get(id);
  return p ? `${p.x + 1},${p.y + 1}` : '?';
}
export function playerCountry(game) { return [...game.countries.values()].find(c => c.isPlayer); }
