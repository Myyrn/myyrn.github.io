import { clamp, addModifier } from './core.js';
import { RESOURCES, BALANCE } from './data.js';

// One tick = BALANCE.TICK_LABEL. Order matches the module dependency graph:
// World Map -> Countries -> Economics -> Nations -> Internal Politics -> Administration.
// (Diplomacy/War are alpha stubs — peace-only, see ui/panels for the notice.)
export function runTick(game) {
  game.tick += 1;
  const { world, countries, nations } = game;

  for (const country of countries.values()) {
    if (country.lifecycleState !== 'active') continue;
    const size = country.territoryProvinceIds.length;

    // --- Economics: raw production feeding country stockpile -----------------
    for (const provId of country.territoryProvinceIds) {
      const p = world.provinces.get(provId);
      p.developmentLevel = clamp(p.developmentLevel + BALANCE.DEVELOPMENT_GROWTH_PER_TICK * (1 + specBonus(country, 'economics')), 0, 1);
      for (const [res, base] of Object.entries(p.rawResourceYields)) {
        const out = base * (0.4 + 0.6 * p.developmentLevel);
        country.resourceStock[res] = (country.resourceStock[res] || 0) + out;
      }
    }
    // recipe chain resolution (greedy, single pass per tier)
    for (const tier of ['SemiFinished', 'LightIndustry']) {
      for (const res of RESOURCES.filter(r => r.tier === tier)) {
        const rec = res.recipe;
        if (!rec) continue;
        let canRun = true;
        for (const input of rec.inputs) {
          const have = country.resourceStock[input.r] || 0;
          if (have < input.a) { canRun = false; break; }
        }
        if (canRun) {
          for (const input of rec.inputs) country.resourceStock[input.r] -= input.a;
          country.resourceStock[res.key] = (country.resourceStock[res.key] || 0) + rec.out;
        }
      }
    }

    // --- Administrative upkeep: the game's core thesis. Bigger structures cost
    // super-linearly more to hold together — this drains Order/loyalty structural
    // baseline as territory grows, independent of any single policy choice. -----
    const upkeepPressure = Math.pow(size / 25, BALANCE.SIZE_UPKEEP_EXPONENT) * 0.01;
    for (const estate of Object.values(country.estates)) {
      estate.loyalty.structuralBaseline = clamp(
        estate.loyalty.structuralBaseline - upkeepPressure + specBonus(country, 'laws') * 0.004,
        -1, 1
      );
      // small pruning-decay pass on modifiers happens implicitly via currentStanding's decay factor
    }

    // --- Prestige / standing (computed, cheap recompute each tick for alpha) ---
    const avgLoyalty = Object.values(country.estates)
      .reduce((s, e) => s + clampedStanding(e.loyalty, game.tick), 0) / 4;
    country.standing.prestige = clamp(0.3 + avgLoyalty * 0.4 + size / 250, 0, 1);
  }

  game.eventLog.unshift({ tick: game.tick, text: `Tick ${game.tick} (${BALANCE.TICK_LABEL}) resolved.` });
  if (game.eventLog.length > 200) game.eventLog.length = 200;
}

function specBonus(country, key) { return country.specialization === key ? 1 : 0; }
function clampedStanding(sv, tick) {
  const decayed = sv.modifiers.reduce((sum, m) => {
    const dt = tick - m.appliedAtTick;
    const f = m.decayHalfLifeTicks === Infinity ? 1 : Math.pow(0.5, dt / m.decayHalfLifeTicks);
    return sum + m.value * f;
  }, 0);
  return clamp(sv.structuralBaseline + decayed, -1, 1);
}

export function applyLoyaltyDelta(game, countryId, estateKey, delta, source) {
  const c = game.countries.get(countryId);
  if (!c) return;
  addModifier(c.estates[estateKey].loyalty, {
    id: `mod_${Math.random().toString(36).slice(2)}`, source, value: delta,
    appliedAtTick: game.tick, decayHalfLifeTicks: BALANCE.STANDING_DECAY_HALF_LIFE,
  });
}
