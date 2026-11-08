// diplomacy/common.js — vocabulary shared by the Diplomacy files (diplomacy__kb, admin_war_diplomacy__spec §5).
export const TIERS = ['Grievance', 'Rights', 'Sovereignty', 'Existential']
export const rank = t => TIERS.indexOf(t) + 1                                   // 0 = no CB at all
export const ALLIANCE_TIERS = ['Guarantee', 'BenevolentNeutrality', 'Defensive', 'Coalition', 'StandingOffensive']
export const NON_AGGRESSION = ['BenevolentNeutrality', 'Defensive', 'StandingOffensive']      // mutual non-aggression (Confederation members too)
export const KINDS = ['Sanction', 'Dependency', 'Alliance', 'Confederation', 'Cooperation']
export const D = ctx => ctx.state.diplomacy
export const countryIds = ctx => Object.keys(ctx.state.countries)
export const treatiesOf = ctx => D(ctx).treaties.filter(t => t.status === 'active')
export const pairKey = (observer, subject) => `${observer}>${subject}`
export const partiesOf = t => (t.kind === 'Sanction' ? [...t.imposers, t.target] : t.kind === 'Dependency' ? [t.overlord, t.subject] : t.parties)
export const isCountry = (ctx, id) => !!ctx.state.countries[id]
export const sum = a => a.reduce((s, x) => s + x, 0)
export const clamp01 = x => Math.min(1, Math.max(0, x))
export function makeDiplomacyState(relations = {}) {
  const treaties = (relations.treaties ?? []).map((t, i) => ({ id: `tr${i}`, status: 'active', since: 0, axes: [], ...structuredClone(t) }))
  for (const c of relations.confederations ?? []) treaties.push({ id: `tr${treaties.length}`, kind: 'Confederation', status: 'active', since: 0, parties: [...c.parties], axes: structuredClone(c.axes ?? []) })
  return { treaties, cbs: [], leverage: {}, grants: [], proposals: [], recognition: {}, claims: structuredClone(relations.claims ?? []) } }
