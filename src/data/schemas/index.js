// data/schemas/index.js — Field definitions for every package document (one definition: loader validation, Editor forms, defaults, docs).
const F = (type, o = {}) => ({ type, ...o })
const num = (o = {}) => F('float', o), int = (o = {}) => F('int', o), str = (o = {}) => F('string', o), bool = (o = {}) => F('bool', o)
const obj = (fields, o = {}) => F('object', { fields, ...o }), rec = (item, o = {}) => F('record', { item, ...o }), list = (item, o = {}) => F('list', { item, ...o })
const ref = (name, o = {}) => F('ref', { ref: name, ...o }), en = (values, o = {}) => F('enum', { values, ...o })
const scope = F('any', { doc: 'shared scope syntax (kernel/scope.js)' })

export const manifestSchema = obj({ schemaVersion: int({ min: 1, required: true }), id: str({ required: true }), name: str({ required: true }), description: str(), seed: int({ required: true }) })
export const worldSchema = obj({
  grid: obj({ w: int({ min: 1, required: true }), h: int({ min: 1, required: true }), orientation: str() }),
  hexes: rec(obj({ x: int(), y: int(), surface: en(['land', 'sea', 'lake'], { required: true }) })),
  provinces: rec(obj({ x: int(), y: int(), terrain: ref('terrain', { required: true }), forestation: int({ min: 0, max: 100, doc: 'within the terrain ceiling' }),
    habitability: en(['Wasteland', 'Claimed/Frontier', 'Settled'], { required: true }), waterSource: en(['river_adjacent', 'coastal', 'none']),
    maxArea: num({ min: 0 }), maxArableArea: num({ min: 0 }), maxPopulationDensity: num({ min: 0 }), population: num({ min: 0 }), urbanization: num({ min: 0, max: 1 }), sanitation: num({ min: 0, max: 1 }),
    infrastructureLevel: num({ min: 0, max: 100 }), tradeInfrastructureLevel: num({ min: 0, max: 100 }), owner: F('any'), provenance: en(['generated', 'manual']), resourceOverrides: rec(num({ min: 0 })) })),
  edges: list(obj({ a: ref('provinces', { required: true }), b: ref('provinces', { required: true }), type: en(['river', 'mountain_pass', 'sea_lane'], { required: true }), fortress: bool(), bridge: bool(), viaHexes: F('any') })),
  warehouses: rec(obj({ capacity: F('any'), stock: rec(num({ min: 0 })) })) })
export const nationsSchema = obj({ nations: rec(obj({ name: str({ required: true }), color: F('color'), reactionTemperament: num({ min: 0, max: 1 }), poolAffinity: rec(num({ min: 0 })), prefTraits: rec(num({ min: -1, max: 1 })) })),
  presence: rec(rec(num({ min: 0 }))) })
export const countriesSchema = obj({ countries: rec(obj({ name: str({ required: true }), color: F('color'), titularNations: list(ref('nations')), isPlayer: bool(), aiProfile: F('any') })) })
export const politySchema = obj({
  estates: rec(obj({ label: str({ required: true }), populationShare: num({ min: 0, max: 1, required: true }), prefBaseline: rec(num({ min: -1, max: 1 })), wealthPerCap: num({ min: 0 }), labourShare: rec(num({ min: 0, max: 1 })) })),
  lawTemplates: rec(obj({ rights: rec(F('any')), duties: rec(F('any')), requisitions: list(F('any')) })),
  countryLaws: rec(obj({ template: ref('lawTemplates', { required: true }), overrides: F('any') })),
  cells: rec(obj({ population: num({ min: 0, required: true }), wealth: num({ min: 0 }), labour: rec(num({ min: 0 })) })),
  governments: rec(obj({ ledger: num({ min: 0 }), commitBureaucrats: num({ min: 0, max: 1 }) })) })
export const relationsSchema = obj({ claims: list(F('any')), treaties: list(F('any')), confederations: list(F('any')) })
export const scenarioSchema = obj({ startTurn: int({ min: 0 }), playerCountry: ref('countries', { required: true }), options: F('any') })
export const rulesetSchema = obj({
  version: int(), status: str(),
  terrain: rec(obj({ forestMin: int({ min: 0, max: 100 }), forestMax: int({ min: 0, max: 100 }), arableCeiling: num({ min: 0, max: 1, status: 'placeholder' }), popDensityCeiling: num({ min: 0, status: 'placeholder' }), favor: rec(num({ min: 0 })), combat: rec(num({ min: 0 })) })),
  goods: rec(obj({ tier: en(['raw', 'semi', 'light', 'heavy', 'transport'], { required: true }), baseValue: num({ min: 0, status: 'placeholder', unit: 'numeraire', doc: 'Refined Precious Metals = 1' }), extractPool: ref('pools'),
    perishable: bool(), decayRate: num({ min: 0, max: 1, status: 'placeholder' }), numeraire: bool(), postAlpha: bool(),
    recipe: obj({ pool: ref('pools'), labourPerRun: num({ min: 0, status: 'placeholder' }), inputs: list(obj({ any: list(ref('goods')), qty: num({ min: 0 }) })), outQty: num({ min: 0 }) }) })),
  pools: rec(obj({ kind: en(['civil', 'army', 'arcane', 'admin']), placeholder: bool(), envelope: obj({ control: num({ min: 0, status: 'placeholder' }), coordination: num({ min: 0, status: 'placeholder' }), observation: num({ min: 0, status: 'placeholder' }) }), combat: F('any') })),
  needs: rec(obj({ class: en(['existential', 'secondary']), kind: en(['material', 'nonMaterial', 'fairness']), tier: en(['subsistence', 'comfort', 'luxury']), accum: num({ min: 0, max: 1, status: 'placeholder' }), decay: num({ min: 0, max: 1, status: 'placeholder' }), axisLoads: rec(num({ min: -1, max: 1 })) })),
  consumption: rec(list(obj({ any: list(ref('goods')), perCapita: num({ min: 0, status: 'placeholder' }) }))),
  rights: F('any'), duties: F('any'), axes: F('any'), cb: F('any'), rituals: F('any'), worldgen: F('any'), war: F('any'),
  tuning: rec(obj({ value: F('any'), status: en(['placeholder', 'authored']) })) })
export const DOC_SCHEMAS = { manifest: manifestSchema, world: worldSchema, nations: nationsSchema, countries: countriesSchema, polity: politySchema, relations: relationsSchema, scenario: scenarioSchema, ruleset: rulesetSchema }
export const CORE_POOLS = ['Agriculture', 'Mining', 'Woodcraft', 'Crafting/Industry', 'Meteomancy/Theurgy', 'Culture', 'Medicine', 'Builders', 'Diplomacy', 'Espionage', 'Trade/Commerce', 'Teaching', 'Bureaucrats', 'Shock Infantry', 'Pike Infantry', 'Skirmishers', 'Cavalry', 'Artillery', 'Siege Corps']
