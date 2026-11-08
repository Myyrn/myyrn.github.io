// polity/derive.js — derived readouts (Rule 1: derived on read). All values 0..1 where stated.
import { parseCellKey } from '../../kernel/ids.js'
import { resolveState } from '../../kernel/scope.js'
import { value as stackValue } from '../../kernel/modifiers.js'
import { scopeCtx } from '../administration/module.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x)), sigmoid = x => 1 / (1 + Math.exp(-x))
const cell = (ctx, k) => ctx.state.polity.cells[k]
const countryOf = (ctx, k) => ctx.derive.worldmap.regionOwner(parseCellKey(k).region)

export function right(ctx, key, id) {                              // silence = allowed (silentDefault)
  const country = countryOf(ctx, key), entries = ctx.state.polity.law[country]?.rights?.[id] ?? []
  return resolveState(entries, key, scopeCtx(ctx, country)) ?? ctx.ruleset.rights?.[id]?.silentDefault }
export function duty(ctx, key, id, dflt) { const country = countryOf(ctx, key); return resolveState(ctx.state.polity.law[country]?.duties?.[id] ?? [], key, scopeCtx(ctx, country)) ?? dflt }
export const marketAccess = (ctx, key) => right(ctx, key, 'MarketAccess') !== false
export const canLend = (ctx, key) => right(ctx, key, 'Lending') !== false
export const awareness = (ctx, key) => { const c = cell(ctx, key), tot = sum(Object.values(c.labour)) || 1
  const share = sum(['Teaching', 'Culture', 'Bureaucrats', 'Diplomacy', 'Trade/Commerce'].map(p => (c.labour[p] ?? 0) / tot))
  return clamp01(ctx.T('aware.base') + ctx.T('aware.k') * share) }
export const prestige = (ctx, key) => { const c = cell(ctx, key), R = ctx.ruleset.rights ?? {}, Du = ctx.ruleset.duties ?? {}
  let p = 0; for (const id of Object.keys(R)) { const v = right(ctx, key, id); p += (R[id].prestigeWeight ?? 0) * (typeof v === 'number' ? v : v ? 1 : 0) }
  const country = countryOf(ctx, key)
  for (const id of Object.keys(Du)) { const v = resolveState(ctx.state.polity.law[country]?.duties?.[id] ?? [], key, scopeCtx(ctx, country)); const burden = typeof v === 'number' ? v : v && typeof v === 'object' ? sum(Object.values(v)) : v ? 1 : 0; p -= (Du[id].prestigeWeight ?? 0) * burden }
  return p + (c.prestigeMods ? stackValue({ baseline: 0, mods: c.prestigeMods }) : 0) }
export const weight = (ctx, key) => cell(ctx, key).population * Math.max(ctx.T('eps.prestige'), ctx.derive.polity.prestige(key))
export function fairnessGap(ctx, key) {                            // >0: under-rewarded relative to standing
  const keys = Object.keys(ctx.state.polity.cells).filter(k => countryOf(ctx, k) === countryOf(ctx, key))
  const contribs = keys.map(k => ctx.derive.economics.contribution(k)), tc = sum(contribs) || 1
  const weights = keys.map(k => ctx.derive.polity.weight(k)), tw = sum(weights) || 1
  const i = keys.indexOf(key); return contribs[i] / tc - weights[i] / tw }
export const opinionGov = (ctx, key) => { const c = cell(ctx, key), sat = c.satisfaction ? (c.satisfaction.subsistence + c.satisfaction.comfort + c.satisfaction.luxury) / 3 : 1
  return ctx.T('opinion.perf') * (sat - ctx.T('opinion.satNeutral')) + sum((c.opinionGovMods ?? []).map(m => m.value)) }
export function compliance(ctx, key) {
  const c = cell(ctx, key), vol = sigmoid(ctx.T('opinion.k') * ctx.derive.polity.opinionGov(key))
  const grant = ctx.derive.administration.controlGrant(key), inv = 1 - Math.exp(-grant / (ctx.T('compliance.controlPerCapita') * Math.max(1, c.population)))
  return { voluntary: vol, involuntary: inv, total: Math.min(1, vol + inv) } }
export function questions(ctx) {                                   // recomputed every read; independent of the Government slate
  const out = []
  for (const [k, c] of Object.entries(ctx.state.polity.cells)) { const comp = ctx.derive.polity.compliance(k).total
    for (const [id, n] of Object.entries(ctx.ruleset.needs)) { const g = c.grievance?.[id] ?? 0; if (g > comp) { const gap = g - comp
      out.push({ key: `${k}|${id}`, cell: k, need: id, gap, tier: n.class === 'existential' && gap > ctx.T('tier.existential') ? 'existential' : gap > ctx.T('tier.structural') ? 'structural' : 'routine' }) } } }
  return out }
export const politySvc = { duty, right, marketAccess, canLend, awareness, prestige, weight, fairnessGap, opinionGov, compliance, questions }
