// client/engineClient.js — async API, main-thread implementation (a Worker can implement the same interface later).
import { resolveTurn, makeCtx } from '../engine/engine.js'
import { createModules, createRegistry } from '../modules/index.js'
import { buildState } from '../data/loaders/buildState.js'
import { effectiveRuleset } from '../data/loaders/readPackage.js'
import * as D from '../modules/economics/derive.js'
import { simpleWarOrders } from '../modules/ai/simpleWar.js'
import { simpleDiplomacyOrders } from '../modules/ai/simpleDiplomacy.js'
import { readouts } from './readouts.js'
const sum = a => a.reduce((s, x) => s + x, 0)
export class EngineClient {
  constructor() { this.modules = createModules(); this.registry = createRegistry(); this.orders = []; this.history = [] }
  async init(pkg, baseRuleset) { this.version = 0; this.ruleset = effectiveRuleset(baseRuleset, pkg.overrides); this.state = buildState(pkg, this.ruleset); this.seq = 0; this.orders = []; return this.snapshotMeta() }
  snapshotMeta() { return { turn: this.state.meta.turn, player: this.state.player } }
  /** A cached read-only ctx: one clone per state version (init / end of turn), so many UI queries in a render share derive memoisation. */
  viewCtx() { if (!this._view || this._viewTurn !== this.version) { this._view = this.ctx(); this._viewTurn = this.version } return this._view }
  ctx() { return makeCtx(structuredClone(this.state), this.ruleset, { modules: this.modules, registry: this.registry, start: this.state }) }
  async submit(order) { const o = { id: `o${this.state.meta.turn}.${this.seq++}`, visibility: 'public', ...order }; this.orders.push(o); return this.orders.length }
  async clearOrders() { this.orders = [] }
  async removeOrder(id) { this.orders = this.orders.filter(o => o.id !== id) }
  async endTurn() { const r = resolveTurn(this.state, this.ruleset, this.orders, { modules: this.modules, registry: this.registry, aiOrders: (s0, rs) => { const c = makeCtx(structuredClone(s0), rs, { modules: this.modules, registry: this.registry, start: s0 }); return [...simpleWarOrders(c), ...simpleDiplomacyOrders(c)] } }); this.state = r.state; this.orders = []
    this.version++; this.history.push(this.summary()); return { report: r.report, turn: this.state.meta.turn } }
  async runTurns(n) { for (let i = 0; i < n; i++) await this.endTurn(); return this.snapshotMeta() }
  summary() { const ctx = this.ctx(), out = { turn: this.state.meta.turn, countries: {} }
    for (const cid of Object.keys(this.state.countries)) { const cs = Object.values(this.state.polity.cells).filter(c => ctx.derive.worldmap.regionOwner(c.region) === cid), pop = sum(cs.map(c => c.population)) || 1
      out.countries[cid] = { population: pop, ledger: this.state.admin.governments[cid].ledger, subsistence: sum(cs.map(c => c.satisfaction.subsistence * c.population)) / pop,
        grievance: sum(cs.map(c => (c.grievance.subsistence ?? 0) * c.population)) / pop, questions: ctx.derive.polity.questions().filter(q => ctx.derive.worldmap.regionOwner(this.state.polity.cells[q.cell].region) === cid).length } }
    return out }
  async query(name, args = {}) { const ctx = this.ctx()
    if (name === 'cells') return Object.values(this.state.polity.cells).filter(c => !args.country || ctx.derive.worldmap.regionOwner(c.region) === args.country).map(c => ({ key: c.key, population: Math.round(c.population), wealth: Math.round(c.wealth),
      freeShock: Math.floor((c.labour['Shock Infantry'] ?? 0) - (c.labourCommitted['Shock Infantry'] ?? 0)), satisfaction: c.satisfaction, grievance: c.grievance, compliance: ctx.derive.polity.compliance(c.key), rung: Math.max(0, ...Object.entries(this.state.polity.rung).filter(([k]) => k.startsWith(c.key + '|')).map(([, v]) => v)) }))
    if (name === 'zones') { const zs = D.zones(ctx); return Object.entries(zs).map(([hub, ps]) => ({ hub, provinces: ps.length, owner: this.state.world.provinces[hub].owner })) }
    if (name === 'map') return { grid: this.state.world.grid, hexes: this.state.world.hexes, provinces: this.state.world.provinces, regions: this.state.world.regionSnapshot.assignment, countries: this.state.countries, edges: this.state.world.edges }
    if (name === 'armies') return Object.values(this.state.war.armies).map(a => ({ id: a.id, owner: a.owner, position: a.position, destination: a.destination, tactic: a.tactic, men: Math.round(a.units.reduce((s, u) => s + this.state.war.units[u].n, 0)), cohesion: +(a.units.reduce((s, u) => s + this.state.war.units[u].cohesion, 0) / a.units.length).toFixed(2), supply: +(a.units.reduce((s, u) => s + this.state.war.units[u].supply, 0) / a.units.length).toFixed(2) }))
    if (name === 'wars') return structuredClone(this.state.war.wars).map(w => ({ ...w, occupations: Object.keys(this.state.war.occupations).length }))
    if (name === 'diplomacy') return structuredClone(this.state.diplomacy)
    if (name === 'blocs') return structuredClone(this.state.war.blocs ?? {})
    if (name === 'occupations') return structuredClone(this.state.war.occupations)
    if (name === 'government') return structuredClone(this.state.admin.governments[args.country])
    if (name === 'law') return structuredClone(this.state.polity.law[args.country])
    if (name === 'history') return this.history
    if (readouts[name]) return JSON.parse(JSON.stringify(readouts[name](this, this.viewCtx(), args) ?? null))      // plain JSON by construction (UI Rule 4: nothing live leaks out)
    throw new Error(`unknown query ${name}`) }
}
