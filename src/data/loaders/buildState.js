// data/loaders/buildState.js — Scenario Package + Ruleset -> GameState (plain JSON).
import { makeDiplomacyState } from '../../modules/diplomacy/common.js'
import { seedFrom } from '../../kernel/rng.js'
import { cellKey } from '../../kernel/ids.js'
import { edgeKey } from '../../modules/worldmap/hex.js'
import { deriveRegions } from '../../modules/worldmap/regions.js'
const sum = a => a.reduce((s, x) => s + x, 0)
export function buildState(pkg, ruleset) {
  const w = pkg.world, provinces = {}
  for (const [id, p] of Object.entries(w.provinces)) provinces[id] = { ...p }
  const owners = Object.fromEntries(Object.entries(provinces).map(([id, p]) => [id, p.owner ?? null]))
  const regs = deriveRegions({ w: w.grid.w, h: w.grid.h }, owners)
  const edges = {}; for (const e of w.edges) edges[edgeKey(e.a, e.b)] = { ...e }
  const cells = {}
  for (const [key, c] of Object.entries(pkg.polity.cells)) { const [nation, estate, region] = key.split('|')
    cells[key] = { key, nation, estate, region, population: c.population, wealth: c.wealth, labour: { ...c.labour }, labourCommitted: {}, grievance: {},
      satisfaction: { subsistence: 1, comfort: 1, luxury: 1 }, target: {}, delivered: {}, opinionGovMods: [], prestigeMods: [], fairnessMods: [], cash: 0, pref: { ...(pkg.polity.estates?.[estate]?.prefBaseline ?? {}) }, defiance: {}, hoard: {}, hoardFrac: 0,
      laborProfile: { ...(pkg.polity.estates?.[estate]?.labourShare ?? {}) }, prefMods: {}, flags: {} } }
  const ownerOfRegion = r => provinces[regs.regions[r]?.provinces[0]]?.owner
  const law = {}, governments = {}
  for (const [cid, cl] of Object.entries(pkg.polity.countryLaws)) { const t = structuredClone(pkg.polity.lawTemplates[cl.template]); law[cid] = { rights: t.rights ?? {}, duties: t.duties ?? {}, requisitions: t.requisitions ?? [] }
    for (const [k, v] of Object.entries(cl.overrides ?? {})) Object.assign(law[cid][k], v) }
  for (const cid of Object.keys(pkg.countries.countries)) { const g = pkg.polity.governments?.[cid] ?? {}
    governments[cid] = { ledger: g.ledger ?? 0, spendingDial: { entries: [] }, controlDial: { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] },
      observationDial: { entries: [] }, inventory: {}, upkeepFraction: 0 }
    if (g.commitBureaucrats) for (const c of Object.values(cells)) if (ownerOfRegion(c.region) === cid) c.labourCommitted.Bureaucrats = (c.labour.Bureaucrats ?? 0) * g.commitBureaucrats }
  const totalWealth = sum(Object.values(cells).map(c => c.wealth)), vol0 = Math.max(1, sum(Object.values(cells).map(c => c.population)) * 0.1)
  return { meta: { turn: pkg.scenario.startTurn ?? 0, rng: seedFrom(String(pkg.manifest.seed)), seq: 0, scenario: pkg.manifest.id }, pending: [], commitments: [],
    world: { grid: w.grid, hexes: w.hexes, provinces, regionSnapshot: { assignment: regs.assignment, next: regs.next, owners: Object.fromEntries(Object.entries(regs.regions).map(([r, v]) => [r, v.owner])) }, edges },
    nations: { presence: structuredClone(pkg.nations.presence), affinity: Object.fromEntries(Object.entries(pkg.nations.nations ?? {}).map(([id, n]) => [id, { ...(n.poolAffinity ?? {}) }])) },
    economy: { warehouses: structuredClone(w.warehouses ?? {}), tradeInfra: Object.fromEntries(Object.entries(provinces).map(([id, p]) => [id, p.tradeInfrastructureLevel ?? 0])), obligations: [], land: {}, lastOutput: {}, lastRate: {},
               coinage: { supply: Math.max(1, totalWealth), lastVolume: vol0, ratio0: Math.max(1, totalWealth) / vol0 } },
    war: { units: {}, armies: {}, wars: [], score: [], sieges: {}, occupations: {}, blocs: {}, seq: 0 },
    diplomacy: makeDiplomacyState(pkg.relations),
    polity: { cells, momentum: {}, rung: {}, log: [], law }, admin: { governments }, countries: pkg.countries.countries, player: pkg.scenario.playerCountry } }
