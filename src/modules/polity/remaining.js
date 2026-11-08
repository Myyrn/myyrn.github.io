// polity/remaining.js — Mobility, Demotion, Convergence, propaganda: step wiring + action types.
import { stepPropaganda, directedShare, propagandaDraw, amalgam, pushPreference, freePoolLabour, PROPAGANDA_POOLS } from './propaganda.js'
import { stepMobility } from './mobility.js'
import { stepDemotion, netPosition } from './demotion.js'
import { convergenceCandidates, checklistDistance, divergeCell, runConvergence } from './convergence.js'
import { scopeCtx } from '../administration/module.js'
import { covers } from '../../kernel/scope.js'
import { cellsOf, countryOfKey, effectivePref, prefMods } from './cellstate.js'
const clamp01 = x => Math.min(1, Math.max(0, x))

/** Start of polity step 5, before updateGrievance, so grievance/opinion see the new populations and preferences. */
export function stepRemainingPolity(ctx) {
  const report = { propaganda: stepPropaganda(ctx), mobility: stepMobility(ctx), demotion: stepDemotion(ctx) }
  report.diverged = Object.keys(cellsOf(ctx)).map(k => divergeCell(ctx, k)).filter(Boolean)       // a reform reversed a Convergence
  return report }
export const remainingDerive = { directedShare, propagandaDraw, amalgam, netPosition: (ctx, k) => netPosition(ctx, k), checklistDistance, convergenceCandidates: ctx => convergenceCandidates(ctx) }
export const remainingHandlers = { 'polity.converge': runConvergence }       // scheduled at step 8, BEFORE the Region re-derivation

// Veto domain of each Rights/Duties entry (gating is per-entry; no covering Right -> executes)
const DOMAIN = { Taxation: 'taxLaw', Requisition: 'market', MarketAccess: 'market', ForeignTradeAccess: 'market', SkilledLabourPermissions: 'skilledLabour', SkilledLabourDuty: 'skilledLabour',
  Retinue: 'retinue', EstateMobility: 'administration', Demotion: 'administration', Levy: 'administration', LocalJurisdiction: 'administration', Council: 'administration' }
const loss = (before, after) => { const n = v => (typeof v === 'number' ? v : v && typeof v === 'object' ? Object.values(v).reduce((a, b) => a + b, 0) : v ? 1 : 0); return n(after) - n(before) }

/** Set scoped Rights/Duties entries (most specific scope wins at read); value === null removes the entry for that scope. Shared by the reform action and rebel-peace concessions. */
export function applyLawEntries(ctx, country, entries) {
  const law = (ctx.state.polity.law[country] ??= { rights: {}, duties: {}, requisitions: [] })
  for (const e of entries) { const scope = e.scope ?? { kind: 'empire' }, k = JSON.stringify(scope), list = ((law[e.kind] ??= {})[e.id] ??= []).filter(x => JSON.stringify(x.scope) !== k)
    if (e.value !== null) list.push({ scope, value: e.value, declaredTurn: ctx.state.meta.turn, seq: ctx.state.meta.seq }); law[e.kind][e.id] = list } }

export function registerRemainingActions(reg) {
  // Generic Rights/Duties reform bundle: sets scoped entries (most specific scope wins at read). value === null removes the entry for that scope.
  reg.register({ id: 'reformRightsDuties', module: 'polity', class: 'event', defaultVisibility: 'public', costs: () => [], axisLoads: { conservatism_reformism: 1 },
    gateDomain: (ctx, a) => (a.params.entries ?? []).map(e => DOMAIN[e.id]).find(Boolean) ?? null,
    validate: (ctx, a) => { const es = a.params?.entries; if (!Array.isArray(es) || !es.length) return { ok: false, reasons: ['entries required'] }
      for (const e of es) if (!['rights', 'duties'].includes(e.kind) || !ctx.ruleset[e.kind]?.[e.id]) return { ok: false, reasons: [`unknown ${e.kind}.${e.id}`] }
      return { ok: true } },
    impact: (ctx, a, key) => { let l = 0; const sc = scopeCtx(ctx, a.actor.country)
      for (const e of a.params.entries) if (covers(e.scope ?? { kind: 'empire' }, key, sc)) { const cur = e.kind === 'rights' ? ctx.derive.polity.right(key, e.id) : ctx.derive.polity.duty(key, e.id, 0); l += e.kind === 'rights' ? -loss(cur, e.value) : loss(cur, e.value) }
      return { cost: l > 0 ? clamp01(0.3 * l) : 0, relief: l < 0 ? clamp01(-0.3 * l) : 0 } },
    apply: (ctx, a) => applyLawEntries(ctx, a.actor.country, a.params.entries) })
  reg.register({ id: 'setMobilityGap', module: 'polity', class: 'event', defaultVisibility: 'public', gateDomain: () => 'administration', costs: () => [], axisLoads: { homogenizing_pluralist: 1 },
    validate: (ctx, a) => typeof a.params?.gap === 'number' && a.params.from && a.params.to && a.params.from !== a.params.to ? { ok: true } : { ok: false, reasons: ['gap, from, to required'] },
    apply: (ctx, a) => { ((ctx.state.polity.mobilityGap ??= {})[a.actor.country] ??= {})[`${a.params.from}>${a.params.to}`] = a.params.gap } })       // blocks further conversion only; never reverts movers
  reg.register({ id: 'declareConvergence', module: 'polity', class: 'event', defaultVisibility: 'public', gateDomain: () => 'administration', costs: () => [], axisLoads: { conservatism_reformism: 1 },
    validate: ctx => (convergenceCandidates(ctx).length ? { ok: true } : { ok: false, reasons: ['no cell pair with checklist distance 0'] }),
    apply: (ctx, a) => ctx.schedule({ dueStep: 8, kind: 'polity.converge', payload: { scope: a.params?.scope ?? null }, source: a.id }) })
  reg.register({ id: 'forceConvergence', module: 'polity', class: 'event', cellAvailability: 'defiance', minRung: 4, defaultVisibility: 'public', costs: () => [], axisLoads: { conservatism_reformism: 1 },
    propose: (ctx, key) => (convergenceCandidates(ctx).some(p => p.includes(key)) ? {} : null),
    utility: (ctx, key) => { const c = cellsOf(ctx)[key], inv = ctx.derive.polity.compliance(key).involuntary, anger = Math.max(0, ...Object.values(c.grievance ?? {}))
      return ctx.T('conv.force') * anger * (1 - inv) - ctx.T('defy.risk') * inv },
    validate: () => ({ ok: true }), apply: (ctx, a) => ctx.schedule({ dueStep: 8, kind: 'polity.converge', payload: { cell: a.actor.key }, source: a.id }) })
  // ---- propaganda: standing commitment. Cells direct Culture/Teaching labour; the Government directs Coordination. Covert for non-Government actors by default.
  reg.register({ id: 'propaganda', module: 'polity', class: 'commitment', gateDomain: () => null, axisLoads: {}, costs: () => [],
    defaultVisibility: 'covert',
    validate: (ctx, a) => { const p = a.params ?? {}; if (!(p.amount > 0)) return { ok: false, reasons: ['amount must be > 0'] }
      if (a.actor.kind === 'government') return { ok: true }
      if (!PROPAGANDA_POOLS.includes(p.pool)) return { ok: false, reasons: [`pool must be one of ${PROPAGANDA_POOLS}`] }
      return p.amount <= freePoolLabour(ctx, a.actor.key, p.pool) + 1e-9 ? { ok: true } : { ok: false, reasons: ['not enough free labour in the pool (zero-sum with ordinary use)'] } },
    apply: (ctx, a) => { ctx.state.commitments.push({ id: a.id, actor: a.actor, type: 'propaganda', claims: [], since: ctx.state.meta.turn, renew: true, params: { ...a.params, targets: a.params.targets ?? { kind: 'empire' } } }) },
    affectedCells: (ctx, a) => [] })
  reg.register({ id: 'liftPropaganda', module: 'polity', class: 'event', gateDomain: () => null, defaultVisibility: 'public', costs: () => [], axisLoads: {},
    validate: (ctx, a) => (ctx.state.commitments.some(c => c.id === a.params?.id && c.type === 'propaganda') ? { ok: true } : { ok: false, reasons: ['no such commitment'] }),
    apply: (ctx, a) => { ctx.state.commitments = ctx.state.commitments.filter(c => c.id !== a.params.id) } })
  // ---- counter-propaganda (cell, permitted, pool-gated): the cell pulls ITSELF back toward its own baseline; re-decided every turn like hoarding
  reg.register({ id: 'counterPropaganda', module: 'polity', class: 'commitment', cellAvailability: 'permitted', minRung: 1, defaultVisibility: 'public', costs: () => [], axisLoads: {},
    propose: (ctx, key) => { const c = cellsOf(ctx)[key], free = freePoolLabour(ctx, key, 'Culture'), drift = Object.values(c.prefMods ?? {}).flat().reduce((s, m) => s + Math.abs(m.value), 0)
      return free > 0 && drift > ctx.T('eps.modifier') ? { pool: 'Culture', amount: ctx.T('cprop.frac') * free } : null },
    utility: (ctx, key) => ctx.T('cprop.k') * Object.values(cellsOf(ctx)[key].prefMods ?? {}).flat().reduce((s, m) => s + Math.abs(m.value), 0) - 0.01,
    validate: () => ({ ok: true }),
    apply: (ctx, a) => { const c = cellsOf(ctx)[a.actor.key], ideal = Object.fromEntries(Object.keys(c.prefMods ?? {}).map(ax => [ax, c.pref?.[ax] ?? 0])); pushPreference(ctx, c, ideal, a.params.amount, { source: a.id }) } })
}
