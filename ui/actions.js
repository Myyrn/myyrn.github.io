import { el, playerCountry } from './panels.js';
import {
  getExpansionTargets, getConquestTargets, estimateConquestOdds,
  settleWasteland, conquerProvince, persuadeEstate, suppressEstate, grantRights,
} from '../actions.js';
import { ESTATE_DEFS } from '../data.js';
import { currentStanding } from '../core.js';

export function renderActionsTab(container, game, onChanged) {
  const player = playerCountry(game);
  container.innerHTML = '';
  container.appendChild(el('div', 'panel-title', 'Rule Your Realm'));
  const status = el('div', 'callout dim', 'Choose an action below.');

  // ---------------------------------------------------------- Expansion
  container.appendChild(el('div', 'section-label', 'Expansion — settle a bordering wasteland'));
  const expTargets = getExpansionTargets(game);
  if (!expTargets.length) {
    container.appendChild(el('div', 'callout dim', 'No wasteland borders your territory right now.'));
  } else {
    const wrap = el('div', 'action-list');
    for (const id of expTargets.slice(0, 12)) {
      const p = game.world.provinces.get(id);
      const row = el('div', 'action-row');
      row.innerHTML = `<div><b>Province ${p.x + 1},${p.y + 1}</b><div class="estate-meta">cost: 20 Stone, 20 Timber</div></div>`;
      const btn = el('button', 'btn-ghost', 'Settle');
      btn.addEventListener('click', () => run(() => settleWasteland(game, id)));
      row.appendChild(btn);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
  }

  // ---------------------------------------------------------- Conquest
  container.appendChild(el('div', 'section-label', 'Conquest — annex a bordering province (no treaty required)'));
  const conqTargets = getConquestTargets(game);
  if (!conqTargets.length) {
    container.appendChild(el('div', 'callout dim', 'No foreign province borders your territory right now.'));
  } else {
    const wrap = el('div', 'action-list');
    for (const id of conqTargets.slice(0, 12)) {
      const p = game.world.provinces.get(id);
      const owner = game.countries.get(p.ownerCountryId);
      const odds = Math.round(estimateConquestOdds(game, id) * 100);
      const row = el('div', 'action-row');
      row.innerHTML = `<div><b>Province ${p.x + 1},${p.y + 1}</b> <span class="tag">${owner.name}</span>
        <div class="estate-meta">cost: 15 Steel, 10 Cold Weapons · odds ${odds}%</div></div>`;
      const btn = el('button', 'btn-ghost', 'Attack');
      btn.addEventListener('click', () => run(() => conquerProvince(game, id)));
      row.appendChild(btn);
      wrap.appendChild(row);
    }
    container.appendChild(wrap);
    container.appendChild(el('div', 'callout',
      `Conquest earns the target an "ignored claim" casus belli against you and a lasting Opinion hit — ` +
      `it upsets the status quo, it doesn't erase it.`));
  }

  // ---------------------------------------------------------- Estates
  container.appendChild(el('div', 'section-label', 'Estates — soft-power management'));
  const estWrap = el('div', 'estate-list');
  for (const def of ESTATE_DEFS) {
    const est = player.estates[def.key];
    const loy = currentStanding(est.loyalty, game.tick);
    const row = el('div', 'estate-row');
    row.appendChild(el('div', 'estate-name', `${def.name} <span class="estate-meta">loyalty ${loy >= 0 ? '+' : ''}${loy.toFixed(2)} · rights ${Math.round(est.rights * 100)}%</span>`));
    const btnRow = el('div', 'action-btn-row');
    const bPersuade = el('button', 'btn-ghost', 'Persuade (+loyalty)');
    bPersuade.title = 'Costs 5 Consumer Goods';
    bPersuade.addEventListener('click', () => run(() => persuadeEstate(game, def.key)));
    const bSuppress = el('button', 'btn-ghost', 'Suppress (extract goods)');
    bSuppress.addEventListener('click', () => run(() => suppressEstate(game, def.key)));
    const bRights = el('button', 'btn-ghost', 'Grant rights');
    bRights.title = 'Costs 10 Preserved Food';
    bRights.addEventListener('click', () => run(() => grantRights(game, def.key)));
    btnRow.appendChild(bPersuade); btnRow.appendChild(bSuppress); btnRow.appendChild(bRights);
    row.appendChild(btnRow);
    estWrap.appendChild(row);
  }
  container.appendChild(estWrap);
  container.appendChild(status);

  function run(fn) {
    const result = fn();
    status.textContent = result.message;
    status.className = `callout ${result.ok ? '' : 'bar-bad-text'}`;
    onChanged();
  }
}
