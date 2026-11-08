// editor/templates.js — blank package factory: a valid, playable starting point for a new scenario (shared ruleset supplied by the caller).
export function newPackage(ruleset, { id = 'new', name = 'New scenario', w = 12, h = 8, seed = 1 } = {}) {
  const hexes = {}, provinces = {}
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { hexes[`h:${x},${y}`] = { x, y, surface: 'land' }
    provinces[`p:${x},${y}`] = { x, y, terrain: 'Grassland', forestation: 25, habitability: 'Settled', waterSource: 'none', maxArea: 100, maxArableArea: 60, maxPopulationDensity: 6, population: 400, urbanization: 0.1, sanitation: 0.5,
      infrastructureLevel: 30, tradeInfrastructureLevel: 40, owner: x < w / 2 ? 'alpha' : 'beta', provenance: 'manual' } }
  const presence = Object.fromEntries(Object.entries(provinces).map(([p, pr]) => [p, { [pr.owner === 'alpha' ? 'north' : 'south']: 400 }]))
  const law = { rights: {}, duties: { Taxation: [{ scope: { kind: 'empire' }, value: { market: 0.05, wealth: 0 }, declaredTurn: 0 }] }, requisitions: [] }
  return { manifest: { schemaVersion: 1, id, name, description: '', seed }, ruleset: structuredClone(ruleset), overrides: {},
    world: { grid: { w, h, orientation: 'pointy-top-odd-r' }, hexes, provinces, edges: [], warehouses: {} },
    nations: { nations: { north: { name: 'Northerners', color: '#2980b9', reactionTemperament: 0.5, poolAffinity: {}, prefTraits: {} }, south: { name: 'Southerners', color: '#c0392b', reactionTemperament: 0.5, poolAffinity: {}, prefTraits: {} } }, presence },
    countries: { countries: { alpha: { name: 'Alpha', color: '#2980b9', titularNations: ['north'], isPlayer: true, aiProfile: null }, beta: { name: 'Beta', color: '#c0392b', titularNations: ['south'], isPlayer: false, aiProfile: 'default' } } },
    polity: { estates: { peasants: { label: 'Peasantry', populationShare: 0.92, prefBaseline: {}, wealthPerCap: 0.5, labourShare: { Agriculture: 0.4, Mining: 0.04, Woodcraft: 0.04, 'Crafting/Industry': 0.2, 'Trade/Commerce': 0.02, Medicine: 0.01, Builders: 0.01, Teaching: 0.005, Culture: 0.005 } },
      nobility: { label: 'Nobility', populationShare: 0.08, prefBaseline: {}, wealthPerCap: 6, labourShare: { Bureaucrats: 0.25, Cavalry: 0.15, Diplomacy: 0.05, Culture: 0.05, Teaching: 0.05 } } },
      lawTemplates: { default: law }, countryLaws: { alpha: { template: 'default' }, beta: { template: 'default' } }, cells: {}, governments: { alpha: { ledger: 500, commitBureaucrats: 1 }, beta: { ledger: 500, commitBureaucrats: 1 } } },
    relations: { claims: [], treaties: [], confederations: [] }, scenario: { startTurn: 0, playerCountry: 'alpha', options: { fogOfWar: false } } } }
