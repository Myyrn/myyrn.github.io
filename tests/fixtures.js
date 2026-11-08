// tests/fixtures.js — a tiny world: 1 Country, 1 Region of 4 provinces, 2 Nations' presence, 2 Estates.
import { readFileSync } from 'node:fs'
import { cellKey } from '../src/kernel/ids.js'
import { worldmapModule } from '../src/modules/worldmap/module.js'
import { administrationModule } from '../src/modules/administration/module.js'
import { economicsModule } from '../src/modules/economics/module.js'
import { polityModule } from '../src/modules/polity/module.js'
import { ActionRegistry } from '../src/engine/engine.js'

export const tuning = JSON.parse(readFileSync(new URL('../scenarios/alpha/tuning.defaults.json', import.meta.url)))
export const ruleset = {
  tuning,
  terrain: { Grassland: { favor: { Grain: 6, Wool: 2, Wine: 1 } }, Mountain: { favor: {} } },
  goods: {
    Grain: { tier: 'raw', baseValue: 1, extractPool: 'Agriculture' },
    Wool: { tier: 'raw', baseValue: 1, extractPool: 'Agriculture' },
    Wine: { tier: 'raw', baseValue: 2, extractPool: 'Agriculture' },
    Cloth: { tier: 'light', baseValue: 4, recipe: { pool: 'Crafting/Industry', labourPerRun: 1, inputs: [{ any: ['Wool'], qty: 2 }], outQty: 1 } },
  },
  pools: { Agriculture: { envelope: {} }, 'Crafting/Industry': { envelope: {} }, Bureaucrats: { envelope: { control: 2, coordination: 1, observation: 1 } } },
  consumption: { subsistence: [{ any: ['Grain'], perCapita: 0.02 }], comfort: [{ any: ['Cloth'], perCapita: 0.002 }], luxury: [{ any: ['Wine'], perCapita: 0.002 }] },
  needs: {
    subsistence: { class: 'existential', kind: 'material', tier: 'subsistence', accum: 0.5, decay: 0.05 },
    comfort: { class: 'secondary', kind: 'material', tier: 'comfort', accum: 0.1, decay: 0.2 },
    fairness: { class: 'secondary', kind: 'fairness', accum: 0.1, decay: 0.2 },
  },
  rights: { MarketAccess: { silentDefault: true }, Lending: { silentDefault: true }, Council: { silentDefault: false, prestigeWeight: 1 } },
  duties: { Taxation: { prestigeWeight: 0 } },
}
export const modules = [worldmapModule, administrationModule, economicsModule, polityModule]
export const registry = new ActionRegistry()

export function makeState({ labour = 100, pop = 1000 } = {}) {
  const provs = {}, presence = {}, assignment = {}
  ;['p:0,0', 'p:1,0', 'p:2,0', 'p:3,0'].forEach((id, i) => {
    provs[id] = { x: i, y: 0, terrain: 'Grassland', forestation: 20, habitability: 'Settled', owner: 'A', population: 500 }
    presence[id] = { v: 100, k: 100 }; assignment[id] = 'r1' })
  const mk = (nation, estate, labourBy) => ({ key: cellKey(nation, estate, 'r1'), nation, estate, region: 'r1', population: pop, wealth: 50,
    labour: labourBy, grievance: {}, satisfaction: { subsistence: 1, comfort: 1, luxury: 1 }, target: {}, delivered: {} })
  const cells = {}
  for (const [n, e, l] of [['v', 'peasants', { Agriculture: labour, 'Crafting/Industry': 10 }], ['k', 'peasants', { Agriculture: labour, 'Crafting/Industry': 10 }]]) cells[cellKey(n, e, 'r1')] = mk(n, e, l)
  return {
    meta: { turn: 0, rng: 7, seq: 0 }, pending: [], commitments: [],
    world: { grid: { w: 25, h: 20 }, provinces: provs, regionSnapshot: { assignment, next: 2 }, edges: {} },
    nations: { presence },
    economy: { warehouses: {}, tradeInfra: Object.fromEntries(Object.keys(provs).map(p => [p, 50])), obligations: [], land: {}, lastOutput: {},
               coinage: { supply: 1000, lastVolume: 100, ratio0: 10 } },
    polity: { cells, momentum: {}, rung: {}, log: [], law: { A: { rights: {}, duties: {}, requisitions: [] } } },
    admin: { governments: { A: { ledger: 100, spendingDial: { entries: [] }, controlDial: { entries: [] }, controlSupply: 0 } } },
  }
}
