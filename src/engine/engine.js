// engine/engine.js — pure turn resolution. No DOM, no Date, no Math.random.
import { makeRng } from '../kernel/rng.js'
import { makeMemo } from '../kernel/derive.js'
import { ClaimLedger } from '../kernel/claims.js'
import { stance, approves } from '../kernel/stance.js'

export class ActionRegistry {
  constructor() { this.types = new Map() }
  register(t) { if (t.thresholdBound && typeof t.targetScale !== 'function') throw new Error(`${t.id}: threshold-bound types must declare targetScale`); this.types.set(t.id, t) }
  get(id) { const t = this.types.get(id); if (!t) throw new Error(`unknown action type ${id}`); return t }
  cellTypes() { return [...this.types.values()].filter(t => t.cellAvailability) }
}

export function makeCtx(state, ruleset, {modules, registry, start, viewer}) {
  const memo = makeMemo(), rng = makeRng(state.meta.rng)
  const ctx = { state, ruleset, start, viewer, rng, modules, registry,
    T: key => { const t = ruleset.tuning[key]; if (!t) throw new Error(`missing tuning key ${key}`); return t.value },
    derive: {}, handlers: {}, decayFns: Object.assign({}, ...modules.map(m => m.decayFns ?? {})), report: null, harmQueue: [], polityQueue: {requisitionHits: []},
    bump: () => memo.bump(), module: id => modules.find(m => m.id === id), schedule: spec => schedule(ctx, spec), nextId: prefix => nextId(ctx, prefix) }
  ctx.services = {}
  for (const m of modules) { ctx.services[m.id] = Object.fromEntries(Object.entries(m.services ?? {}).map(([k, f]) => [k, (...a) => f(ctx, ...a)])); ctx.derive[m.id] = {}; for (const [k, f] of Object.entries(m.derive ?? {})) ctx.derive[m.id][k] = memo.fn(`${m.id}.${k}`, (...a) => f(ctx, ...a)); Object.assign(ctx.handlers, m.handlers ?? {}) }
  return ctx
}

export class TurnReport { constructor() { this.executed = []; this.rejected = []; this.refused = []; this.entitlementLosses = [] }
  reject(a, reasons) { this.rejected.push({id: a.id, type: a.type, reasons}) }
  refuse(a, g) { this.refused.push({id: a.id, type: a.type, holders: g.holders}) } }

// ---- scheduler (deferred effects)
export function nextId(ctx, prefix) { return `${prefix}${ctx.state.meta.seq = (ctx.state.meta.seq ?? 0) + 1}` }
export const schedule = (ctx, {dueTurnOffset = 0, dueStep, kind, payload, source}) =>
  ctx.state.pending.push({id: nextId(ctx, 'pe'), dueTurn: ctx.state.meta.turn + dueTurnOffset, dueStep, kind, payload, source})
export function runDue(ctx, step) {
  const due = ctx.state.pending.filter(p => p.dueTurn === ctx.state.meta.turn && p.dueStep === step)
  for (const p of due) ctx.handlers[p.kind](ctx, p.payload)
  ctx.state.pending = ctx.state.pending.filter(p => !due.includes(p))
}

// ---- gating (derived, never stored)
export function gate(ctx, a) {
  const t = ctx.registry.get(a.type), domain = t.gateDomain?.(ctx, a) ?? null
  if (!domain) return {blocked: false}
  const holders = ctx.module('polity').gateHolders(ctx, a.actor, domain), foreign = ctx.module('diplomacy')?.foreignVetoes?.(ctx, a, domain) ?? []      // DomainVeto grantees (Countries) also hold a Veto
  if (!holders.length && !foreign.length) return {blocked: false}
  const verdicts = holders.map(c => ({cell: c, s: stance(c, a, ctx, ctx.module('polity').stanceFns(ctx, a.type))}))
  const refusers = verdicts.filter(v => !approves(v.s, ctx))
  if (foreign.length) return {blocked: true, foreign, holders: [...refusers.map(v => v.cell), ...foreign], verdicts}
  return refusers.length ? {blocked: true, holders: refusers.map(v => v.cell), verdicts} : {blocked: false, verdicts}
}
export function validate(ctx, a) {
  const t = ctx.registry.get(a.type), v = t.validate ? t.validate(ctx, a) : {ok: true}
  return v.ok === false ? v : {ok: true}
}
export function writeLog(ctx, a, t) {
  ctx.state.polity.log.push({actor: a.actor, action_type: a.type, visibility: a.visibility ?? t.defaultVisibility ?? 'public',
    turn: ctx.state.meta.turn, affected_cells: t.affectedCells ? t.affectedCells(ctx, a) : []})
}

function step2(ctx, planned) {
  ctx.claims = new ClaimLedger(res => ctx.module(res.module ?? 'economics').produced?.(ctx, res) ?? Infinity)
  const cellActs = ctx.module('polity')?.decideCellActions?.(ctx) ?? []
  const all = [...planned, ...cellActs].sort((a, b) => (a.actor.kind + (a.actor.country ?? a.actor.key)).localeCompare(b.actor.kind + (b.actor.country ?? b.actor.key)) || a.id.localeCompare(b.id))
  for (const a of all) {
    const t = ctx.registry.get(a.type)
    const v = validate({...ctx, state: ctx.start}, a); if (!v.ok) { ctx.report.reject(a, v.reasons ?? ['invalid']); continue }
    const g = gate(ctx, a)
    if (g.foreign?.length) { ctx.report.refuse(a, g); continue }                                    // a foreign Veto cannot be forced through Control
    if (g.blocked && !a.forceThroughControl) { ctx.report.refuse(a, g); continue }
    if (g.blocked) { ctx.module('polity').entitlementLoss(ctx, g.holders, a); ctx.report.entitlementLosses.push({id: a.id, holders: g.holders}) }
    if (!ctx.claims.lockAll((t.costs?.(ctx, a) ?? []))) { ctx.report.reject(a, ['insufficient']); continue }
    t.apply(ctx, a); writeLog(ctx, a, t); ctx.report.executed.push(a.id); ctx.bump()
  }
}

export function resolveTurn(state0, ruleset, orders, {modules, registry, viewer, aiOrders = () => []}) {
  const state = structuredClone(state0)
  const ctx = makeCtx(state, ruleset, {modules, registry, start: state0, viewer})
  ctx.report = new TurnReport()
  const planned = [...orders, ...aiOrders(state0, ruleset)]
  for (let n = 1; n <= 8; n++) {
    ctx.bump(); runDue(ctx, n)
    if (n === 2) step2(ctx, planned)
    else for (const m of modules) m.steps?.[n]?.(ctx)
  }
  state.meta.turn += 1; state.meta.rng = ctx.rng.state()
  return {state, report: ctx.report}
}
