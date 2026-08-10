import { addModifier, clamp, newId } from './core.js';
import { relKey } from './world/countries.js';
import { BALANCE } from './data.js';

// ============================================================================
// RULER ACTIONS — the only place player intent mutates owned state outside the
// tick loop. Every action returns { ok, message } and never throws; the UI
// layer just displays the message. Costs/effects are read from BALANCE so the
// Data Editor can tune them without touching this file.
// ============================================================================

const COSTS = {
  settle: { Stone: 20, Timber: 20 },
  conquer: { Steel: 15, ColdWeapons: 10 },
  persuade: { ConsumerGoods: 5 },
  grantRights: { PreservedFood: 10 },
};

function playerOf(game) { return [...game.countries.values()].find(c => c.isPlayer); }

function canAfford(stock, cost) {
  return Object.entries(cost).every(([r, a]) => (stock[r] || 0) >= a);
}
function pay(stock, cost) {
  for (const [r, a] of Object.entries(cost)) stock[r] -= a;
}

// ---- Expansion (Phase I: unlimited but risky growth) ----------------------
export function getExpansionTargets(game) {
  const player = playerOf(game);
  const owned = new Set(player.territoryProvinceIds);
  const targets = new Set();
  for (const provId of owned) {
    const p = game.world.provinces.get(provId);
    for (const nb of p.adjacentProvinceIds) {
      const pn = game.world.provinces.get(nb);
      if (pn.habitability === 'Wasteland') targets.add(nb);
    }
  }
  return [...targets];
}

export function settleWasteland(game, provinceId) {
  const player = playerOf(game);
  const p = game.world.provinces.get(provinceId);
  if (!p || p.habitability !== 'Wasteland') return { ok: false, message: 'That province cannot be settled.' };
  if (!canAfford(player.resourceStock, COSTS.settle)) {
    return { ok: false, message: `Not enough Stone/Timber to settle (${COSTS.settle.Stone} Stone, ${COSTS.settle.Timber} Timber needed).` };
  }
  pay(player.resourceStock, COSTS.settle);
  p.habitability = 'Settled';
  p.ownerCountryId = player.id;
  p.developmentLevel = 0.15;
  p.fortificationLevel = 0;
  player.territoryProvinceIds.push(provinceId);

  let note = '';
  if (Math.random() < 0.15) {
    // Unwise, hurried growth has unpredictable consequences — small overextension shock.
    const keys = Object.keys(player.estates);
    const hit = keys[Math.floor(Math.random() * keys.length)];
    addModifier(player.estates[hit].loyalty, {
      id: newId('mod'), source: 'overextension_shock', value: -0.06,
      appliedAtTick: game.tick, decayHalfLifeTicks: BALANCE.STANDING_DECAY_HALF_LIFE,
    });
    note = ` The rushed settlement unsettled the ${cap(hit)} (-loyalty).`;
  }
  return { ok: true, message: `New settlement founded.${note}` };
}

// ---- Conquest (direct annexation, no diplomacy/treaty gate in this alpha) --
export function getConquestTargets(game) {
  const player = playerOf(game);
  const owned = new Set(player.territoryProvinceIds);
  const targets = new Set();
  for (const provId of owned) {
    const p = game.world.provinces.get(provId);
    for (const nb of p.adjacentProvinceIds) {
      const pn = game.world.provinces.get(nb);
      if (pn.habitability === 'Settled' && pn.ownerCountryId && pn.ownerCountryId !== player.id) targets.add(nb);
    }
  }
  return [...targets];
}

export function estimateConquestOdds(game, provinceId) {
  const player = playerOf(game);
  const p = game.world.provinces.get(provinceId);
  const sizePenalty = Math.max(0, (player.territoryProvinceIds.length - 25) / 10) * 0.03;
  const specBonus = player.specialization === 'military' ? 0.15 : 0;
  const odds = clamp(0.5 + specBonus - p.fortificationLevel * 0.3 - sizePenalty, 0.05, 0.9);
  return odds;
}

export function conquerProvince(game, provinceId) {
  const player = playerOf(game);
  const p = game.world.provinces.get(provinceId);
  if (!p || p.habitability !== 'Settled' || !p.ownerCountryId || p.ownerCountryId === player.id) {
    return { ok: false, message: 'That province cannot be attacked.' };
  }
  if (!canAfford(player.resourceStock, COSTS.conquer)) {
    return { ok: false, message: `Not enough Steel/Cold Weapons to campaign (${COSTS.conquer.Steel} Steel, ${COSTS.conquer.ColdWeapons} Cold Weapons needed).` };
  }
  const defender = game.countries.get(p.ownerCountryId);
  pay(player.resourceStock, COSTS.conquer);

  const odds = estimateConquestOdds(game, provinceId);
  const won = Math.random() < odds;
  const rel = game.relations.get(relKey(player.id, defender.id));
  addModifier(rel.opinion, {
    id: newId('mod'), source: 'unprovoked_attack', value: -0.3,
    appliedAtTick: game.tick, decayHalfLifeTicks: BALANCE.STANDING_DECAY_HALF_LIFE * 2,
  });
  rel.casusBelli.push({
    id: newId('cb'), holderCountryId: defender.id, targetCountryId: player.id,
    triggerType: 'ignored_claim', severity: 0.7, earnedTick: game.tick,
    decayHalfLifeTicks: 60, used: false,
  });

  if (won) {
    defender.territoryProvinceIds = defender.territoryProvinceIds.filter(id => id !== provinceId);
    player.territoryProvinceIds.push(provinceId);
    p.ownerCountryId = player.id;
    bumpLoyalty(game, player, 'nobility', +0.04, 'conquest_glory');
    bumpLoyalty(game, player, 'peasants', -0.06, 'war_weariness');
    return { ok: true, message: `Victory! ${defender.name} loses the province (${Math.round(odds * 100)}% odds).` };
  } else {
    bumpLoyalty(game, player, 'nobility', -0.08, 'conquest_failure');
    bumpLoyalty(game, player, 'peasants', -0.03, 'war_weariness');
    return { ok: false, message: `The campaign failed (${Math.round(odds * 100)}% odds) — resources lost, ${defender.name} is enraged.` };
  }
}

// ---- Estate management ------------------------------------------------------
export function persuadeEstate(game, estateKey) {
  const player = playerOf(game);
  if (!canAfford(player.resourceStock, COSTS.persuade)) {
    return { ok: false, message: `Not enough Consumer Goods to hold court (${COSTS.persuade.ConsumerGoods} needed).` };
  }
  pay(player.resourceStock, COSTS.persuade);
  const bonus = player.specialization === 'laws' ? 0.06 : 0.04;
  bumpLoyalty(game, player, estateKey, +bonus, 'persuasion');
  return { ok: true, message: `The ${cap(estateKey)} are courted (+loyalty).` };
}

export function suppressEstate(game, estateKey) {
  const player = playerOf(game);
  // Extract resources from an unhappy Estate at the cost of further resentment.
  const gain = 8 + Math.round(Math.random() * 12);
  const res = Math.random() < 0.5 ? 'Grain' : 'Stone';
  player.resourceStock[res] = (player.resourceStock[res] || 0) + gain;
  bumpLoyalty(game, player, estateKey, -0.08, 'suppression');
  return { ok: true, message: `${cap(estateKey)} suppressed — +${gain} ${res}, loyalty falls.` };
}

export function grantRights(game, estateKey) {
  const player = playerOf(game);
  if (!canAfford(player.resourceStock, COSTS.grantRights)) {
    return { ok: false, message: `Not enough Preserved Food for the ceremony (${COSTS.grantRights.PreservedFood} needed).` };
  }
  const est = player.estates[estateKey];
  if (est.rights >= 1) return { ok: false, message: `${cap(estateKey)} already hold full rights.` };
  pay(player.resourceStock, COSTS.grantRights);
  est.rights = clamp(est.rights + 0.08, 0, 1);
  est.loyalty.structuralBaseline = clamp(est.loyalty.structuralBaseline + 0.03, -1, 1);
  // other Estates grow a little jealous of the newly-elevated one
  for (const [key, other] of Object.entries(player.estates)) {
    if (key === estateKey) continue;
    bumpLoyalty(game, player, key, -0.015, 'estate_jealousy');
  }
  return { ok: true, message: `${cap(estateKey)} granted broader rights (${Math.round(est.rights * 100)}%).` };
}

function bumpLoyalty(game, country, estateKey, delta, source) {
  addModifier(country.estates[estateKey].loyalty, {
    id: newId('mod'), source, value: delta,
    appliedAtTick: game.tick, decayHalfLifeTicks: BALANCE.STANDING_DECAY_HALF_LIFE,
  });
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
