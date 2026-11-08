import { stackValue } from '../src/kernel/scope.js'
export const TUNE = { 'eps.modifier': 1e-4, 'prop.rate': 0.1, 'pref.modRange': 2, 'pref.modDecay': 0.1, 'edu.rate': 0.01, 'teach.rate': 0.02,
  'opinion.modDecay': 0.1, 'mob.eligibleShare': 0.1, 'mob.originGain': 0.5, 'mob.destResent': 0.5, 'demo.rate': 0.2, 'demo.control': 0.1,
  'demo.opinion': 1.5, 'demo.opinionDecay': 0.01, 'demo.destResent': 0.3, 'conv.eps': 1e-6, 'prop.resist': 1 }
const AXES = ['extraction_investment', 'conservatism_reformism']
export const mkCell = (key, pop, o = {}) => ({ key, population: pop, wealth: o.wealth ?? 0, labour: o.labour ?? {}, grievance: o.grievance ?? { subsistence: 0 },
  opinionGov: { baseline: 0, mods: [] }, pref: Object.fromEntries(AXES.map(a => [a, { baseline: o.pref?.[a] ?? 0, mods: [], lo: -1, hi: 1 }])),
  laborProfile: o.profile ?? {}, prestigeMods: [], flags: {}, ...o.extra })
export function mkCtx(cells, { law = {}, prestige = {}, obligations = [], commitments = [], ruleset } = {}) {
  const ctx = { turn: 1, T: k => { if (!(k in TUNE)) throw new Error('missing tuning ' + k); return TUNE[k] },
    ruleset: ruleset ?? { rights: { EstateMobility: { silentDefault: 0 }, Council: { silentDefault: false } }, duties: { Demotion: { silentDefault: 0 }, Taxation: { silentDefault: 0 } },
      pools: { Agriculture: {}, Mining: {}, Teaching: {}, Culture: {} } },
    state: { polity: { cells: Object.fromEntries(cells.map(c => [c.key, c])), law: { empire: { rights: {}, duties: {}, ...law } }, momentum: {}, rung: {} },
             economy: { obligations }, commitments, nations: { vantir: { poolAffinity: { Mining: 3 } } } },
    countryOf: () => 'empire', polityQueue: { controlGains: [] },
    derive: { polity: { prestige: (c, cell) => prestige[cell.key] ?? 1, compliance: () => ({ involuntary: 1 }), observedPortrait: () => ({ extraction_investment: 0.8 }) } } }
  ctx.derive.polity.prestige = (_, cell) => prestige[cell.key] ?? 1
  ctx.derive.polity.directedShare = (c, k, p) => 0
  return ctx
}
export { stackValue }
