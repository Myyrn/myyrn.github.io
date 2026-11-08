// tools/buildRuleset.mjs — generates data/ruleset.json (THE shared ruleset). All numbers are placeholders (status tracked per section).
import { readFileSync, writeFileSync } from 'node:fs'
const tuning = JSON.parse(readFileSync(new URL('../scenarios/alpha/tuning.defaults.json', import.meta.url)))

const terrain = {   // kb: forestation ceilings + favor table; arable / density ceilings are placeholders from the qualitative kb levels
  Mountain: { forestMin: 0, forestMax: 40, arableCeiling: 0.15, popDensityCeiling: 0.2, favor: { 'Iron Ore': 8, 'Precious Metal Ore': 8, Coal: 6, Stone: 8, Sulfur: 5 } },
  Hill: { forestMin: 10, forestMax: 70, arableCeiling: 0.5, popDensityCeiling: 0.5, favor: { Stone: 4, 'Iron Ore': 3, Coal: 3, 'Fine Horses': 2, Wool: 2 } },
  Desert: { forestMin: 0, forestMax: 10, arableCeiling: 0.05, popDensityCeiling: 0.05, favor: { Salt: 6, Sulfur: 4, 'Precious Metal Ore': 2 } },
  Steppe: { forestMin: 0, forestMax: 40, arableCeiling: 0.5, popDensityCeiling: 0.3, favor: { 'Fine Horses': 8, Livestock: 5, Wool: 3 } },
  Grassland: { forestMin: 10, forestMax: 70, arableCeiling: 0.9, popDensityCeiling: 1.0, favor: { Grain: 6, Livestock: 5, Wool: 2 } },   // forest ceiling: kb flags for correction
  Wetland: { forestMin: 20, forestMax: 70, arableCeiling: 0.4, popDensityCeiling: 0.7, favor: { Fish: 5, Fiber: 5, Salt: 3, Herbs: 3, 'Iron Ore': 2 } },
  Jungle: { forestMin: 60, forestMax: 100, arableCeiling: 0.2, popDensityCeiling: 0.4, favor: { Herbs: 8, 'Magical Reagents': 5, Fiber: 4 } },
  Arctic: { forestMin: 0, forestMax: 15, arableCeiling: 0.02, popDensityCeiling: 0.05, favor: { Fish: 4, Hides: 3, 'Precious Metal Ore': 2 } },
  Taiga: { forestMin: 50, forestMax: 90, arableCeiling: 0.2, popDensityCeiling: 0.25, favor: { Hides: 5, Fish: 3 } },
}
const raw = { Grain: 'Agriculture', Livestock: 'Agriculture', 'Fine Horses': 'Agriculture', Fiber: 'Agriculture', Wool: 'Agriculture', Hides: 'Agriculture', Herbs: 'Agriculture',
  Stone: 'Mining', 'Iron Ore': 'Mining', 'Precious Metal Ore': 'Mining', Coal: 'Mining', Sulfur: 'Mining', Salt: 'Mining',
  Timber: 'Woodcraft', Fish: 'Fishing', 'Magical Reagents': 'Reagent Gathering' }
const baseRaw = { Grain: 0.6, Livestock: 1, 'Fine Horses': 4, Fish: 0.7, Timber: 0.5, Stone: 0.5, 'Iron Ore': 1, 'Precious Metal Ore': 4, Coal: 0.8, Sulfur: 1.5, Fiber: 0.6, Wool: 0.8, Hides: 0.8, Salt: 1, Herbs: 1.2, 'Magical Reagents': 3 }
const I = (any, qty) => ({ any: Array.isArray(any) ? any : [any], qty })
const semi = { Flour: [[I('Grain', 1)], 'Crafting/Industry', 1.2], Lumber: [[I('Timber', 1)], 'Woodcraft', 1.2], 'Cut Stone': [[I('Stone', 1)], 'Crafting/Industry', 1.6],
  Steel: [[I('Iron Ore', 2), I('Coal', 1)], 'Crafting/Industry', 5], 'Refined Precious Metals': [[I('Precious Metal Ore', 3)], 'Crafting/Industry', 1],
  Cloth: [[I(['Wool', 'Fiber'], 2)], 'Crafting/Industry', 2.5], 'Tanned Leather': [[I('Hides', 1)], 'Crafting/Industry', 1.5],
  'Preserved Food': [[I(['Livestock', 'Fish'], 1), I('Salt', 0.2)], 'Crafting/Industry', 2], Gunpowder: [[I('Sulfur', 1), I('Coal', 1)], 'Crafting/Industry', 5],
  'Processed Reagents': [[I('Magical Reagents', 2)], 'Crafting/Industry', 8], Paper: [[I(['Fiber', 'Timber'], 1)], 'Crafting/Industry', 2], Ink: [[I('Herbs', 1)], 'Crafting/Industry', 2], 'Quills/Printing Colors': [[I('Herbs', 1)], 'Crafting/Industry', 2] }
const light = { Bread: [[I('Flour', 1)], 'Crafting/Industry', 1.6], Garments: [[I(['Cloth', 'Tanned Leather'], 1)], 'Crafting/Industry', 4], 'Furniture/Household Goods': [[I('Lumber', 2)], 'Crafting/Industry', 5],
  Medicine: [[I('Herbs', 2)], 'Medicine', 6], 'Consumer/Luxury Goods': [[I('Cloth', 1), I('Refined Precious Metals', 0.2)], 'Crafting/Industry', 9], 'Printed Goods': [[I('Paper', 1), I('Ink', 1)], 'Crafting/Industry', 7] }
const heavy = { 'Cold Weapons': [[I('Steel', 1)], 'Crafting/Industry', 8], Armor: [[I('Steel', 2), I('Tanned Leather', 1)], 'Crafting/Industry', 20], Firearms: [[I('Steel', 1), I('Gunpowder', 1)], 'Crafting/Industry', 15],
  Artillery: [[I('Steel', 4), I('Gunpowder', 2)], 'Crafting/Industry', 60], 'Tools & Machinery': [[I('Steel', 1), I('Lumber', 1)], 'Crafting/Industry', 10], Ships: [[I('Lumber', 10), I('Cloth', 4)], 'Builders', 90],
  Fortifications: [[I('Cut Stone', 10)], 'Builders', 40] }
const transport = { 'Draft Animals': [[I(['Livestock', 'Fine Horses'], 1)], 'Agriculture', 5], 'Carts/Carriages': [[I('Lumber', 2), I('Tools & Machinery', 0.2)], 'Crafting/Industry', 8],
  'Transport Machinery': [[I('Steel', 2), I('Tools & Machinery', 1)], 'Crafting/Industry', 40] }
const goods = {}
for (const [g, pool] of Object.entries(raw)) goods[g] = { tier: 'raw', baseValue: baseRaw[g], extractPool: pool, perishable: ['Grain', 'Livestock', 'Fish', 'Herbs'].includes(g), decayRate: 0.05 }
const add = (tbl, tier) => { for (const [g, [inputs, pool, v]] of Object.entries(tbl)) goods[g] = { tier, baseValue: v, perishable: ['Flour', 'Bread', 'Preserved Food', 'Medicine'].includes(g), decayRate: 0.03, recipe: { pool, labourPerRun: 1, inputs, outQty: 1 }, ...(g === 'Transport Machinery' ? { postAlpha: true } : {}) } }
add(semi, 'semi'); add(light, 'light'); add(heavy, 'heavy'); add(transport, 'transport')
goods['Refined Precious Metals'].baseValue = 1; goods['Refined Precious Metals'].numeraire = true      // THE numeraire (kb): base value 1

const armyPools = { 'Shock Infantry': 'army', 'Pike Infantry': 'army', Skirmishers: 'army', Cavalry: 'army', Artillery: 'army', 'Siege Corps': 'army' }
const corePools = ['Agriculture', 'Mining', 'Woodcraft', 'Crafting/Industry', 'Meteomancy/Theurgy', 'Culture', 'Medicine', 'Builders', 'Diplomacy', 'Espionage', 'Trade/Commerce', 'Teaching', 'Bureaucrats', ...Object.keys(armyPools)]
const env = { Bureaucrats: { control: 3, coordination: 2, observation: 2 }, Diplomacy: { control: 0, coordination: 3, observation: 1 }, Espionage: { control: 1, coordination: 1, observation: 3 },
  Teaching: { control: 0, coordination: 1, observation: 0 }, Culture: { control: 0, coordination: 1, observation: 0 }, 'Trade/Commerce': { control: 0, coordination: 1, observation: 1 },
  'Shock Infantry': { control: 2, coordination: 0, observation: 0 }, 'Pike Infantry': { control: 2, coordination: 0, observation: 0 }, Skirmishers: { control: 1, coordination: 0, observation: 1 }, Cavalry: { control: 1, coordination: 0, observation: 1 } }
const pools = {}
for (const p of corePools) pools[p] = { kind: armyPools[p] ?? (['Meteomancy/Theurgy'].includes(p) ? 'arcane' : ['Bureaucrats', 'Diplomacy', 'Espionage'].includes(p) ? 'admin' : 'civil'), envelope: env[p] ?? { control: 0, coordination: 0, observation: 0 } }
pools.Fishing = { kind: 'civil', placeholder: true, envelope: { control: 0, coordination: 0, observation: 0 } }
pools['Reagent Gathering'] = { kind: 'civil', placeholder: true, envelope: { control: 0, coordination: 0, observation: 0 } }

const combat = { 'Shock Infantry': { meleeAtk: 1.0, meleeDef: 0.9, rangedAtk: 0, speed: 1, tags: ['melee'] }, 'Pike Infantry': { meleeAtk: 0.7, meleeDef: 1.2, rangedAtk: 0, speed: 1, tags: ['reach'] },
  Skirmishers: { meleeAtk: 0.3, meleeDef: 0.4, rangedAtk: 0.8, speed: 1, tags: ['ranged'] }, Cavalry: { meleeAtk: 1.2, meleeDef: 0.7, rangedAtk: 0, speed: 3, tags: ['mounted'] },
  Artillery: { meleeAtk: 0.1, meleeDef: 0.2, rangedAtk: 3.0, speed: 1, tags: ['ranged'] }, 'Siege Corps': { meleeAtk: 0.2, meleeDef: 0.3, rangedAtk: 0, speed: 1, tags: ['siege'], siege: 2 } }
for (const [k, v] of Object.entries(combat)) pools[k].combat = { ...v, upkeep: { Bread: 0.05, Garments: 0.005 } }
const war = { interaction: { mounted: { reach: 0.4, ranged: 1.5, melee: 1, mounted: 1, siege: 1.2 }, melee: { melee: 1, reach: 0.8, mounted: 1, ranged: 1.2, siege: 1.2 }, reach: { melee: 1, reach: 1, mounted: 1.5, ranged: 1, siege: 1 },
  ranged: { melee: 1, reach: 1, mounted: 1, ranged: 1, siege: 1 }, siege: { melee: 1, reach: 1, mounted: 1, ranged: 1, siege: 1 } }, harassVsMelee: 0.4 }
const needs = {
  subsistence: { class: 'existential', kind: 'material', tier: 'subsistence', accum: 0.5, decay: 0.05 }, comfort: { class: 'secondary', kind: 'material', tier: 'comfort', accum: 0.1, decay: 0.2 },
  luxury: { class: 'secondary', kind: 'material', tier: 'luxury', accum: 0.05, decay: 0.3 },
  identity_autonomy: { class: 'existential', kind: 'nonMaterial', accum: 0.4, decay: 0.05, axisLoads: { homogenizing_pluralist: 1 } },
  solidarity: { class: 'existential', kind: 'nonMaterial', accum: 0.4, decay: 0.05 }, purpose_meaning: { class: 'secondary', kind: 'nonMaterial', accum: 0.1, decay: 0.2 },
  faith_cosmology: { class: 'secondary', kind: 'nonMaterial', accum: 0.1, decay: 0.2, axisLoads: { fervor_secular: 1 } },
  security: { class: 'secondary', kind: 'nonMaterial', accum: 0.1, decay: 0.2, axisLoads: { ruthlessness_restraint: 1, conservatism_reformism: -1 } },
  excellence: { class: 'secondary', kind: 'nonMaterial', accum: 0.1, decay: 0.2, axisLoads: { extraction_investment: 1, conservatism_reformism: 1 } },
  superiority: { class: 'secondary', kind: 'nonMaterial', accum: 0.1, decay: 0.2, axisLoads: { homogenizing_pluralist: -1, ruthlessness_restraint: -1 } },
  pleasure: { class: 'secondary', kind: 'nonMaterial', accum: 0.1, decay: 0.2 }, fairness: { class: 'secondary', kind: 'fairness', accum: 0.1, decay: 0.2 } }
const consumption = { subsistence: [{ any: ['Bread', 'Preserved Food'], perCapita: 0.03 }, { any: ['Garments'], perCapita: 0.005 }, { any: ['Coal', 'Lumber'], perCapita: 0.01 }],
  comfort: [{ any: ['Furniture/Household Goods'], perCapita: 0.005 }, { any: ['Medicine'], perCapita: 0.005 }], luxury: [{ any: ['Consumer/Luxury Goods'], perCapita: 0.002 }, { any: ['Printed Goods'], perCapita: 0.002 }] }
const rights = {}
const R = (id, valueType, silentDefault, w = 0) => rights[id] = { valueType, silentDefault, prestigeWeight: w }
R('Council', 'bool', false, 2); for (const d of ['war', 'autonomyTitular', 'market', 'skilledLabour', 'administration', 'retinue', 'treaty', 'taxLaw']) R(`Veto.${d}`, 'bool', false, 1)
R('LocalJurisdiction', 'scopeList', false, 1); R('Petition', 'bool', true, 0.2); R('Retinue', 'scalar', 0, 0.5); R('MarriageAutonomy', 'bool', true); R('MovementAutonomy', 'bool', true)
R('LegalImmunity', 'bool', false, 1); R('SkilledLabourPermissions', 'bitmask', 'all'); R('MarketAccess', 'bool', true); R('ForeignTradeAccess', 'bool', true); R('Minting', 'bool', false, 0.5)
R('Lending', 'bool', true); R('TradeInfraConstruction', 'bool', true); R('Settlement', 'bool', true); R('TariffExemption', 'bool', false, 0.3); R('EstateMobility', 'scalar', 0, 0)
const duties = {}; for (const d of ['Taxation', 'Levy', 'SkilledLabourDuty', 'Requisition', 'Corvee', 'Hospitality', 'LoyaltyOath', 'Demotion']) duties[d] = { valueType: d === 'Taxation' ? 'rate' : 'amount', prestigeWeight: 0.5 }
const axes = {}; for (const a of ['CultureLanguageSovereignty', 'MilitaryCap', 'ForeignPolicy', 'TradeAccess', 'Fortification', 'ResourceExportBan', 'LaborMigrationBan', 'DomainVeto']) axes[a] = { symmetricAllowed: true }
for (const a of ['Succession', 'CommonRuler']) axes[a] = { symmetricAllowed: true, postAlpha: true }

const ruleset = { version: 1, status: 'placeholder numbers (numbers pass pending)', terrain, goods, pools, needs, consumption, rights, duties, axes,
  war,
  cb: { tiers: ['Grievance', 'Rights', 'Sovereignty', 'Existential'] }, rituals: {},
  worldgen: { landFraction: 0.45, waterSourcePrecedence: ['river_adjacent', 'coastal'] },
  tuning }
writeFileSync(new URL('../data/ruleset.json', import.meta.url), JSON.stringify(ruleset, null, 1))
console.log('goods', Object.keys(goods).length, 'pools', Object.keys(pools).length, 'needs', Object.keys(needs).length, 'rights', Object.keys(rights).length)
