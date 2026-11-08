// polity/step.js — step 5 (order matters): grievance, attribution, decay, Questions, momentum/rungs.
import { parseCellKey } from '../../kernel/ids.js'
import { tick, push, makeStack } from '../../kernel/modifiers.js'
import { stepRemainingPolity } from './remaining.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x))

export function updateGrievance(ctx, key) {
  const c = ctx.state.polity.cells[key]; c.grievance ??= {}
  for (const [id, n] of Object.entries(ctx.ruleset.needs)) {
    let shortfall
    if (n.kind === 'material') shortfall = 1 - (c.satisfaction?.[n.tier] ?? 1)
    else if (n.kind === 'fairness') shortfall = clamp01(ctx.derive.polity.fairnessGap(key) * ctx.T('fair.scale')) + sum((c.fairnessMods ?? []).map(m => m.value))
    else { const target = c.target?.[id] ?? 0; shortfall = target > ctx.T('eps.need') ? 1 - (c.delivered?.[id] ?? 0) / target : 0 }
    if (id === 'security') shortfall += clamp01(c.warHarm ?? 0) + (ctx.derive.war?.occupiedShare?.(key) ?? 0)          // war-attributable grievance (also read back as the Exhaustion readout)
    c.grievance[id] = clamp01((c.grievance[id] ?? 0) * (1 - n.decay) + n.accum * clamp01(shortfall))      // leaky accumulator
  } }
export function readDecisionLog(ctx) {                              // attribution = harm x attributability(awareness x causal visibility)
  for (const h of ctx.harmQueue) { const c = ctx.state.polity.cells[h.cell]; if (!c) continue
    const entry = ctx.state.polity.log.find(e => e.id === h.logId), vis = entry ? (entry.visibility === 'public' ? 1 : 0) : 0
    let k = ctx.derive.polity.awareness(h.cell) * vis; if (h.kind === 'war') k = k ** ctx.T('attr.warSteepness')
    if (ctx.derive.polity.awareness(h.cell) < ctx.T('attr.lowAwareness')) k = 0                         // low awareness: blame redirected (fate / local authority)
    c.opinionGovMods ??= []; if (k > 0) c.opinionGovMods.push({ id: `att.${h.logId}`, value: -h.magnitude * k, decay: { kind: 'exp', rateKey: 'opinion.modDecay' }, turn: ctx.state.meta.turn, source: h.logId }) }
  ctx.harmQueue.length = 0 }
const rungOf = (ctx, m, prev) => { const en = ctx.T('rung.enter'), ex = ctx.T('rung.exit'); let r = 0
  for (let i = 0; i < en.length; i++) if (m >= en[i] || (prev >= i + 1 && m >= ex[i])) r = i + 1; return r }
export function updateMomentum(ctx, q) {
  const P = ctx.state.polity, m0 = P.momentum[q.key] ?? 0
  const m = m0 * (1 - ctx.T('mom.decay')) + ctx.T('mom.rise') * q.gap          // attention factor = 1 (single-Question default)
  P.momentum[q.key] = m; P.rung[q.key] = rungOf(ctx, m, P.rung[q.key] ?? 0) }
export function step5(ctx) {
  const P = ctx.state.polity; P.rung ??= {}
  stepRemainingPolity(ctx)                                  // propaganda, Mobility, Demotion, divergence: before grievance/opinion read the new cells
  for (const k of Object.keys(P.cells)) updateGrievance(ctx, k)
  readDecisionLog(ctx)
  for (const c of Object.values(P.cells)) { for (const key of ['opinionGovMods', 'prestigeMods', 'fairnessMods']) { if (!c[key]) continue
    const s = { baseline: 0, mods: c[key] }; tick(s, ctx); c[key] = s.mods } }
  for (const c of Object.values(P.cells)) for (const ax of Object.keys(c.prefMods ?? {})) { const st = { baseline: 0, mods: c.prefMods[ax] }; tick(st, ctx); c.prefMods[ax] = st.mods }   // preference modifier stacks decay (pref.modDecay)
  ctx.bump()
  const qs = ctx.derive.polity.questions(), live = new Set(qs.map(q => q.key))
  for (const q of qs) updateMomentum(ctx, q)
  for (const key of Object.keys(P.momentum)) if (!live.has(key)) { P.momentum[key] *= 1 - ctx.T('mom.decay'); if (P.momentum[key] < ctx.T('eps.modifier')) { delete P.momentum[key]; delete P.rung[key] } else P.rung[key] = rungOf(ctx, P.momentum[key], P.rung[key] ?? 0) } }
