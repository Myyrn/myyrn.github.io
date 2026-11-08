// polity/actions.js — Government action types (with `impact` for gating/acceptance) and the first cell action types.
import { scopeCtx } from '../administration/module.js'
import { covers } from '../../kernel/scope.js'
const clamp01 = x => Math.min(1, Math.max(0, x))
const cellsMap = ctx => ctx.state.polity.cells
const entryKey = e => JSON.stringify(e.scope)
const scale = (ctx, c) => Math.max(1, (c.salesValue ?? 0) + c.wealth)
const maxGrievance = (c, needs) => Math.max(0, ...needs.map(n => c.grievance?.[n] ?? 0))
const tax = (ctx, key) => ctx.derive.polity.duty(key, 'Taxation', { market: 0, wealth: 0 })

export function registerPolityActions(reg) {
  // ---------------- Government (and Country) actions
  reg.register({ id: 'setTaxLaw', module: 'polity', class: 'event', gateDomain: () => 'taxLaw', defaultVisibility: 'public',
    validate: (ctx, a) => (a.params && typeof a.params.market === 'number' && typeof a.params.wealth === 'number' ? { ok: true } : { ok: false, reasons: ['market and wealth rates required'] }),
    costs: () => [], axisLoads: { extraction_investment: -1 },
    impact: (ctx, a, key) => { const scope = a.params.scope ?? { kind: 'empire' }; if (!covers(scope, key, scopeCtx(ctx, a.actor.country))) return { cost: 0, relief: 0 }
      const cur = tax(ctx, key), c = cellsMap(ctx)[key], delta = (a.params.market - cur.market) * (c.salesValue ?? 0) + (a.params.wealth - cur.wealth) * c.wealth
      return { cost: clamp01(Math.max(0, delta) / scale(ctx, c)), relief: clamp01(Math.max(0, -delta) / scale(ctx, c)) } },
    apply: (ctx, a) => { const country = a.actor.country, law = (ctx.state.polity.law[country] ??= { rights: {}, duties: {}, requisitions: [] })
      const scope = a.params.scope ?? { kind: 'empire' }, list = (law.duties.Taxation ??= []).filter(e => entryKey(e) !== JSON.stringify(scope))
      list.push({ scope, value: { market: a.params.market, wealth: a.params.wealth }, declaredTurn: ctx.state.meta.turn }); law.duties.Taxation = list } })
  reg.register({ id: 'setControlAllocation', module: 'administration', class: 'dial', gateDomain: () => 'administration', defaultVisibility: 'public',
    validate: (ctx, a) => (Array.isArray(a.params?.entries) ? { ok: true } : { ok: false, reasons: ['entries required'] }), costs: () => [], impact: () => ({ cost: 0, relief: 0 }),
    apply: (ctx, a) => { ctx.state.admin.governments[a.actor.country].controlDial = { entries: a.params.entries } } })
  reg.register({ id: 'setSpendingDial', module: 'polity', class: 'dial', gateDomain: () => null, defaultVisibility: 'public',
    validate: (ctx, a) => (Array.isArray(a.params?.entries) ? { ok: true } : { ok: false, reasons: ['entries required'] }), costs: () => [],
    apply: (ctx, a) => { ctx.state.admin.governments[a.actor.country].spendingDial = { entries: a.params.entries, reserve: a.params.reserve ?? 0, sink: a.params.sink ?? 'keep' } } })
  reg.register({ id: 'placeRequisition', module: 'polity', class: 'event', gateDomain: () => 'market', defaultVisibility: 'public',
    validate: (ctx, a) => (a.params?.good ? { ok: true } : { ok: false, reasons: ['good required'] }), costs: () => [], axisLoads: { extraction_investment: -1 },
    impact: (ctx, a, key) => { if (!covers(a.params.scope ?? { kind: 'empire' }, key, scopeCtx(ctx, a.actor.country))) return { cost: 0, relief: 0 }
      const c = cellsMap(ctx)[key]; return { cost: clamp01((a.params.amount ?? 0) * (c.salesValue ?? 0) / scale(ctx, c)), relief: 0 } },
    apply: (ctx, a) => { const law = ctx.state.polity.law[a.actor.country]; law.requisitions = [...law.requisitions.filter(r => r.target.good !== a.params.good),
      ...(a.params.amount > 0 ? [{ scope: a.params.scope ?? { kind: 'empire' }, target: { good: a.params.good }, amount: a.params.amount, unit: 'fraction', since: ctx.state.meta.turn }] : [])] } })

  // ---------------- Cell actions (availability class: permitted | granted | defiance); chosen by the stance skeleton, gated by rung
  reg.register({ id: 'petition', module: 'polity', class: 'event', cellAvailability: 'permitted', minRung: 1, defaultVisibility: 'public', costs: () => [], axisLoads: {},
    propose: (ctx, key) => { const c = cellsMap(ctx)[key], need = Object.keys(c.grievance ?? {}).sort((a, b) => c.grievance[b] - c.grievance[a])[0]; return need && c.grievance[need] > 0 ? { need } : null },
    utility: (ctx, key, p) => ctx.T('petition.effect') * (cellsMap(ctx)[key].grievance?.[p.need] ?? 0) - 0.01,
    validate: () => ({ ok: true }), apply: (ctx, a) => { (ctx.state.polity.petitions ??= []).push({ cell: a.actor.key, need: a.params.need, turn: ctx.state.meta.turn }) } })
  reg.register({ id: 'taxRefusal', module: 'polity', class: 'commitment', cellAvailability: 'defiance', minRung: 2, defaultVisibility: 'public', costs: () => [], axisLoads: { extraction_investment: 1 },
    propose: (ctx, key) => { const r = tax(ctx, key); return r.market > 0 || r.wealth > 0 ? {} : null },
    utility: (ctx, key) => { const c = cellsMap(ctx)[key], inv = ctx.derive.polity.compliance(key).involuntary, anger = maxGrievance(c, ['subsistence', 'fairness'])
      const r = tax(ctx, key), burden = clamp01((r.market * (c.salesValue ?? 0) + r.wealth * c.wealth) / scale(ctx, c)); return anger * (1 - inv) - ctx.T('defy.risk') * inv + 0.5 * burden },
    validate: () => ({ ok: true }), apply: (ctx, a) => { const c = cellsMap(ctx)[a.actor.key]; c.defiance = { ...(c.defiance ?? {}), tax: clamp01((a.params.scale ?? 1) * (1 - ctx.derive.polity.compliance(a.actor.key).involuntary)) } } })
  reg.register({ id: 'hoard', module: 'polity', class: 'commitment', cellAvailability: 'permitted', minRung: 1, defaultVisibility: 'covert', costs: () => [], axisLoads: {},
    propose: () => ({}), utility: (ctx, key) => (cellsMap(ctx)[key].grievance?.subsistence ?? 0) * 0.5 - 0.05,
    validate: () => ({ ok: true }), apply: (ctx, a) => { cellsMap(ctx)[a.actor.key].hoardFrac = ctx.T('hoard.frac') * (a.params.scale ?? 1) } })
  reg.register({ id: 'buildTradeInfra', module: 'economics', class: 'commitment', cellAvailability: 'permitted', minRung: 0, defaultVisibility: 'public', costs: () => [], axisLoads: { extraction_investment: 1 },
    propose: (ctx, key) => { const c = cellsMap(ctx)[key]; return ctx.derive.polity.right(key, 'TradeInfraConstruction') !== false && c.wealth > c.population * ctx.T('infra.richPerCap') ? {} : null },
    utility: (ctx, key) => { const c = cellsMap(ctx)[key], cost = Math.min(c.population * ctx.T('infra.costPerCap'), 0.1 * c.wealth); return clamp01(c.wealth / (c.population * ctx.T('infra.richPerCap'))) * 0.1 - cost / Math.max(1, c.wealth) },
    validate: () => ({ ok: true }), apply: (ctx, a) => { const c = cellsMap(ctx)[a.actor.key], cost = Math.min(c.population * ctx.T('infra.costPerCap'), 0.1 * c.wealth)
      c.wealth -= cost; for (const p of ctx.derive.worldmap.regionProvinces(c.region)) ctx.state.economy.tradeInfra[p] = Math.min(100, (ctx.state.economy.tradeInfra[p] ?? 0) + ctx.T('infra.delta') * (a.params.scale ?? 1)) } })
}
