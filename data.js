// ============================================================================
// DATA TABLES — nothing in this file is simulation logic. Everything here is
// meant to be viewed/edited from the in-game "Data Editor" tab and reloaded.
// The world generator and simulation only ever read these tables by key.
// ============================================================================

export const RESOURCE_TIERS = ['Raw', 'SemiFinished', 'LightIndustry'];

export const RESOURCES = [
  // Raw
  { key: 'Grain', tier: 'Raw', terrainBias: { fertility: 1, aridity: -0.6 } },
  { key: 'Livestock', tier: 'Raw', terrainBias: { fertility: 0.5, wetland: -0.3 } },
  { key: 'Fish', tier: 'Raw', terrainBias: { wetland: 1 } },
  { key: 'Timber', tier: 'Raw', terrainBias: { forestation: 1 } },
  { key: 'Stone', tier: 'Raw', terrainBias: { fertility: -0.4 } },
  { key: 'IronOre', tier: 'Raw', terrainBias: { fertility: -0.5, aridity: 0.3 } },
  { key: 'PreciousMetalOre', tier: 'Raw', terrainBias: { aridity: 0.2 } },
  { key: 'Wool', tier: 'Raw', terrainBias: { aridity: 0.4, fertility: -0.2 } },
  { key: 'Herbs', tier: 'Raw', terrainBias: { forestation: 0.6, wetland: 0.3 } },
  // Semi-finished
  { key: 'Flour', tier: 'SemiFinished', recipe: { inputs: [{ r: 'Grain', a: 2 }], out: 1 } },
  { key: 'Lumber', tier: 'SemiFinished', recipe: { inputs: [{ r: 'Timber', a: 2 }], out: 1 } },
  { key: 'CutStone', tier: 'SemiFinished', recipe: { inputs: [{ r: 'Stone', a: 2 }], out: 1 } },
  { key: 'Steel', tier: 'SemiFinished', recipe: { inputs: [{ r: 'IronOre', a: 2 }], out: 1 } },
  { key: 'Cloth', tier: 'SemiFinished', recipe: { inputs: [{ r: 'Wool', a: 2 }], out: 1 } },
  { key: 'PreservedFood', tier: 'SemiFinished', recipe: { inputs: [{ r: 'Livestock', a: 1, alt: 'Fish' }], out: 1 } },
  // Light industry
  { key: 'Bread', tier: 'LightIndustry', recipe: { inputs: [{ r: 'Flour', a: 2 }], out: 2 } },
  { key: 'Garments', tier: 'LightIndustry', recipe: { inputs: [{ r: 'Cloth', a: 2 }], out: 1 } },
  { key: 'ColdWeapons', tier: 'LightIndustry', recipe: { inputs: [{ r: 'Steel', a: 2 }, { r: 'Lumber', a: 1 }], out: 1 } },
  { key: 'ConsumerGoods', tier: 'LightIndustry', recipe: { inputs: [{ r: 'Garments', a: 1 }, { r: 'PreservedFood', a: 1 }], out: 1 } },
];

export const RAW_RESOURCE_KEYS = RESOURCES.filter(r => r.tier === 'Raw').map(r => r.key);

export const CIVILIAN_LABOR = ['Agriculture', 'Extraction', 'Crafting', 'Culture', 'Teaching'];

export const SPECIALIZATIONS = [
  { key: 'military', name: 'Military', blurb: 'Stronger levies, faster army raising, War Exhaustion resists longer.' },
  { key: 'diplomacy', name: 'Diplomacy', blurb: 'Cheaper ratification, faster Opinion recovery, stronger Leverage.' },
  { key: 'espionage', name: 'Espionage', blurb: 'Better intelligence, covert destabilization of rival Estates.' },
  { key: 'economics', name: 'Economics', blurb: 'Faster production growth, higher storage caps, better trade terms.' },
  { key: 'laws', name: 'Laws', blurb: 'Soft-power control — cheaper Estate persuasion, slower unrest growth.' },
];

export const ESTATE_DEFS = [
  { key: 'nobility', name: 'Nobility', controlDomain: 'Army', baseRights: 0.6 },
  { key: 'clergy', name: 'Clergy', controlDomain: 'SecretPolice', baseRights: 0.5 },
  { key: 'citizens', name: 'Citizens', controlDomain: 'Bureaucrats', baseRights: 0.4 },
  { key: 'peasants', name: 'Peasants', controlDomain: null, baseRights: 0.2 },
];
// NOTE: per design, standing army / bureaucracy / secret police are not separate institutions —
// their controlling-pool function is folded into Nobility / Citizens / Clergy respectively.
// Peasants hold no formal control domain but carry the largest population weight.

export const NATION_NAME_POOL = [
  'Velmoran', 'Ostrenn', 'Kaelic', 'Thurvane', 'Sarnesse', 'Drevik', 'Ambrenn',
  'Colwyth', 'Marrow', 'Isendral', 'Vosk', 'Halewynd',
];

export const COUNTRY_NAME_POOL = [
  'Velmora', 'Ostrenholt', 'Kaelspire', 'Thurvane Reach', 'Sarnesse Union',
  'Drevik Hegemony', 'Ambrenn Crown', 'Colwyth Marches', 'Isendral Concord', 'Voskmere',
];

export const TERRAIN_AXES = ['temperature', 'aridity', 'fertility', 'forestation', 'wetland'];

export const CB_TYPES = ['broken_treaty', 'ignored_claim', 'avenge_insult'];

export function getEditableTables() {
  return {
    Resources: RESOURCES,
    Specializations: SPECIALIZATIONS,
    Estates: ESTATE_DEFS,
    NationNames: NATION_NAME_POOL,
    CountryNames: COUNTRY_NAME_POOL,
    Balance: BALANCE,
  };
}
export function applyTableEdits(parsed) {
  if (parsed.Resources) replaceArray(RESOURCES, parsed.Resources);
  if (parsed.Specializations) replaceArray(SPECIALIZATIONS, parsed.Specializations);
  if (parsed.Estates) replaceArray(ESTATE_DEFS, parsed.Estates);
  if (parsed.NationNames) replaceArray(NATION_NAME_POOL, parsed.NationNames);
  if (parsed.CountryNames) replaceArray(COUNTRY_NAME_POOL, parsed.CountryNames);
  if (parsed.Balance) Object.assign(BALANCE, parsed.Balance);
}
function replaceArray(target, next) {
  target.length = 0;
  target.push(...next);
}

export const BALANCE = {
  GRID_COLS: 25,
  GRID_ROWS: 20, // 25*20 = 500 provinces
  PLAYER_COUNT: 10,
  SETTLED_SHARE: 0.5,
  TICK_LABEL: '1 week',
  STANDING_DECAY_HALF_LIFE: 12,
  PRESSURE_FLOOR: 0.35,
  NECESSITY_DEMAND_GROWTH_RATE: 0.002,
  DEVELOPMENT_GROWTH_PER_TICK: 0.004,
  SIZE_UPKEEP_EXPONENT: 1.35, // "bigger structures are harder to maintain" — administrative cost
                               // scales super-linearly with province count, this is the one knob
                               // that encodes the game's core thesis
};
