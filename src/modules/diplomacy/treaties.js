// diplomacy/treaties.js — proposals, ratification (Administration skeleton under the hood), installation, axis hooks, war chain, recognition.
import { stance, approves } from '../../kernel/stance.js'
import { D, KINDS, ALLIANCE_TIERS, NON_AGGRESSION, treatiesOf, partiesOf, isCountry, countryIds, sum } from './common.js'
import { reputation, addReputation, grantCB, grantsOver, axisGrants, applyOverreach, bestCBRank, externallyRecognised, activeCBs, treatyTier } from './readouts.js'
const W = ctx => ctx.state.war

// ---- axis hooks (data in ruleset.axes; code here). Inert-by-design axes are listed in the module Status: Succession/CommonRuler (post-alpha), Fortification, LaborMigrationBan (no engine consumer yet).
export const militaryCap = (ctx, country) => Math.min(Infinity, ...grantsOver(ctx, country, 'MilitaryCap').map(g => g.terms.maxMen ?? Infinity))
export const titularForced = (ctx, country) => grantsOver(ctx, country, 'CultureLanguageSovereignty').map(g => g.grantee)                 // grantees who force the titular Nation; Countries reads it
export const laborMigrationBanned = (ctx, a, b) => axisGrants(ctx).some(g => g.axis === 'LaborMigrationBan' && ((g.grantor === a && g.grantee === b) || (g.grantor === b && g.grantee === a)))
/** Trade edge factor for a good between two zone hubs: ResourceExportBan (single good) and TradeAccess embargo vs a third party drive throughput_cap to 0. */
export function tradeFactor(ctx, za, zb, good) {
  const a = ctx.state.world.provinces[za]?.owner, b = ctx.state.world.provinces[zb]?.owner; if (!a || !b || a === b) return 1
  for (const g of axisGrants(ctx)) {
    if (g.axis === 'ResourceExportBan' && g.terms.good === good && ((g.grantor === a && g.grantee === b) || (g.grantor === b && g.grantee === a))) return 0
    if (g.axis === 'TradeAccess' && g.terms.embargo && ((g.grantor === a && g.terms.embargo === b) || (g.grantor === b && g.terms.embargo === a))) return 0 }
  return 1 }
/** Veto the grantee holds over named Rights/Duties domains of the grantor (DomainVeto axis; replaces Countries' government_form). Exercised by the grantee Government's stance. */
export function foreignVetoes(ctx, a, domain) {
  const country = a.actor.country ?? ctx.derive.worldmap.regionOwner(ctx.state.polity.cells[a.actor.key]?.region)
  return [...new Set(grantsOver(ctx, country, 'DomainVeto').filter(g => (g.terms.domains ?? []).includes(domain) && g.grantee !== country && isCountry(ctx, g.grantee) && reputation(ctx, g.grantee, country) < ctx.T('veto.repMin')).map(g => g.grantee))] }

// ---- ratification: government stance (material self-interest x relationship history) + cells holding the treaty Veto (same consent machinery as any gated action)
const sharedEnemies = (ctx, a, b) => countryIds(ctx).filter(c => c !== a && c !== b && W(ctx).wars.some(w => w.active && !w.ended && [w.a, w.b].includes(c) && [w.a, w.b].includes(a)) && W(ctx).wars.some(w => w.active && !w.ended && [w.a, w.b].includes(c) && [w.a, w.b].includes(b))).length
export function treatyValue(ctx, party, p) {
  const T = ctx.T, other = p.from === party ? p.to : p.from, n = (p.axes ?? []).length, enemy = T('treaty.enemy') * Math.min(1, sharedEnemies(ctx, party, other))
  switch (p.kind) {
    case 'Alliance': { if (p.tier === 'Guarantee') return (p.guarantor === party ? -T('treaty.guaranteeBurden') : T('treaty.guaranteeBenefit')) + enemy
      if (p.tier === 'BenevolentNeutrality') return T('treaty.bn') + enemy
      return T('treaty.pact') - T('treaty.pactBurden') + enemy - T('treaty.axisBurden') * n }
    case 'Dependency': return p.overlord === party ? T('treaty.axisGain') * n : T('treaty.depBenefit') - T('treaty.axisBurden') * n
    case 'Confederation': return T('treaty.conf') + enemy - T('treaty.axisBurden') * n * T('treaty.confAxisShare')
    case 'Cooperation': return T('treaty.coop') * Math.max(1, (p.cooperation ?? []).length)
    default: return 0 } }
const treatyStanceFns = (ctx, p) => ({ selfInterest: party => treatyValue(ctx, party, p), modifier: party => 1 + ctx.T('treaty.rep') * reputation(ctx, party, p.from === party ? p.to : p.from) })
export function ratify(ctx, p) {
  const parties = [p.from, p.to].filter(x => isCountry(ctx, x))
  for (const party of parties) for (const g of grantsOver(ctx, party, 'ForeignPolicy'))                                 // ForeignPolicy: the party cannot ratify without the grantee's consent
    if (![p.from, p.to].includes(g.grantee) && isCountry(ctx, g.grantee) && reputation(ctx, g.grantee, party) < ctx.T('veto.repMin')) return { ok: false, reason: `ForeignPolicy consent withheld by ${g.grantee}` }
  if (!isCountry(ctx, p.to)) return { ok: true }                                                                       // a rebel bloc accepts a Guarantee / grant: no Veto holders, no government to consult
  if (!p.accepted && !ctx.state.countries[p.to].isPlayer) {                                                             // AI Government decides at once; a player's recipient answers with answerProposal
    if (!approves(stance(p.to, p, ctx, treatyStanceFns(ctx, p)), ctx)) return { ok: false, reason: 'government declined' } }
  const holders = ctx.module('polity').gateHolders(ctx, { kind: 'government', country: p.to }, 'treaty'), a = { id: p.id, type: 'ratifyTreaty', actor: { kind: 'government', country: p.to }, params: p }
  const refusers = holders.filter(c => !approves(stance(c, a, ctx, ctx.module('polity').stanceFns(ctx, 'ratifyTreaty')), ctx)); if (refusers.length) return { ok: false, reason: 'treaty Veto holders refused', holders: refusers }
  return { ok: true } }

export function installTreaty(ctx, spec) {
  const t = { id: ctx.nextId('tr'), status: 'active', since: ctx.state.meta.turn, axes: [], ...structuredClone(spec) }
  if (t.kind === 'Dependency' && !t.subject) t.subject = t.parties?.[1]
  if (t.kind !== 'Sanction' && t.kind !== 'Dependency') t.parties ??= [spec.from, spec.to]
  D(ctx).treaties.push(t); if (t.kind === 'Alliance' && t.tier === 'Guarantee') joinGuaranteedWars(ctx, t)
  ctx.bump(); return t }

export function resolveProposals(ctx) {
  const keep = []
  for (const p of D(ctx).proposals) {
    if (p.status !== 'pending') continue
    if (isCountry(ctx, p.to) && ctx.state.countries[p.to].isPlayer && !p.accepted) { if (ctx.state.meta.turn - p.turn < ctx.T('treaty.proposalTTL')) keep.push(p); continue }   // waits for the player's answer
    const r = ratify(ctx, p)
    if (r.ok) { const spec = { kind: p.kind, tier: p.tier, axes: p.axes, cooperation: p.cooperation, stripsCB: p.stripsCB, from: p.from, to: p.to, guarantor: p.guarantor, overlord: p.overlord, subject: p.subject }
      if (p.kind === 'Alliance' && p.tier === 'Guarantee') spec.parties = [p.guarantor, p.guarantor === p.from ? p.to : p.from]
      if (p.amend) { const old = D(ctx).treaties.find(t => t.id === p.amend); if (old) old.status = 'replaced' }
      installTreaty(ctx, spec) }
    else { p.status = 'rejected'; p.reason = r.reason; ctx.state.diplomacy.rejected = [...(ctx.state.diplomacy.rejected ?? []).slice(-19), { id: p.id, turn: ctx.state.meta.turn, reason: r.reason }] } }
  D(ctx).proposals = keep }                                                                                           // ratified/rejected proposals leave the list (`diplomacy.rejected` keeps the last reasons)

/** Breaking a treaty is a broken promise: Reputational Leverage with every other party (and observers close to them) plus an event-based CB held by the wronged party. */
export function denounce(ctx, t, by) {
  t.status = 'broken'; if (t.kind === 'Sanction') { t.imposers = t.imposers.filter(i => i !== by); t.status = t.imposers.length ? 'active' : 'ended'; return }   // lifting a Sanction is no breach
  t.breach = { by, tier: t.kind === 'Dependency' ? 'Sovereignty' : 'Rights', turn: ctx.state.meta.turn, remedied: true }
  const wronged = partiesOf(t).filter(x => x !== by && isCountry(ctx, x)), tier = t.breach.tier
  for (const w of wronged) { grantCB(ctx, w, by, tier, 'broken-treaty', ctx.T('cb.mag.break')); for (const o of countryIds(ctx)) if (o !== by) addReputation(ctx, o, by, -ctx.T('rep.break') * (o === w ? 1 : (treatyTier(ctx, o, w) ? ctx.T('rep.breakClose') : 0)), 'broken-promise') }
  ctx.bump() }

// ---- war chain: propagation through the treaty graph only (no global tension metric)
export function warChain(ctx, war) {
  const stripped = treatiesOf(ctx).some(t => t.kind === 'Sanction' && t.target === war.a && t.stripsCB), recognisedCB = !stripped && activeCBs(ctx, war.a, war.b).some(c => c.recognised !== false)     // an externally recognised cause; no CB at all is no cause
  const side = { a: new Set([war.a]), b: new Set([war.b]) }
  const joins = (s, who, enemy, isAttacker) => treatiesOf(ctx).filter(t => t.kind === 'Alliance' && t.parties.includes(who)).flatMap(t => {
    const other = t.parties.find(x => x !== who); if (!isCountry(ctx, other)) return []
    if (t.tier === 'Guarantee') return t.parties[1] === who ? [t.parties[0]] : []                                         // guarantor defends the guaranteed, no reciprocal duty
    if (t.tier === 'Defensive') return isAttacker ? (recognisedCB ? [other] : []) : [other]                              // defenders always; the attacker's Defensive allies need an externally recognised cause
    if (t.tier === 'StandingOffensive') return [other]
    if (t.tier === 'Coalition') return isAttacker && t.against === enemy ? [other] : []
    return [] })
  for (const k of ['a', 'b']) { const queue = [...side[k]]; while (queue.length) { const who = queue.shift()
    for (const j of joins(side, who, k === 'a' ? war.b : war.a, k === 'a')) if (!side.a.has(j) && !side.b.has(j) && j !== (k === 'a' ? war.b : war.a)) { side[k].add(j); queue.push(j) } } }
  return { attackers: [...side.a], defenders: [...side.b] } }
export function joinWars(ctx, war) {
  const { attackers, defenders } = warChain(ctx, war), made = []
  for (const x of attackers) for (const y of defenders) {
    if ((x === war.a && y === war.b) || warForbiddenPair(ctx, x, y) || W(ctx).wars.some(w => !w.ended && [w.a, w.b].includes(x) && [w.a, w.b].includes(y))) continue
    const id = ctx.nextId('w'); W(ctx).wars.push({ id, a: x, b: y, active: false, startedTurn: ctx.state.meta.turn, chained: true, chainedFrom: war.id }); made.push(id)
    ctx.schedule({ dueTurnOffset: 1, dueStep: 4, kind: 'war.hostilitiesBegin', payload: { war: id } }) }
  return made }
const warForbiddenPair = (ctx, a, b) => treatiesOf(ctx).some(t => (t.kind === 'Confederation' || (t.kind === 'Alliance' && NON_AGGRESSION.includes(t.tier))) && t.parties.includes(a) && t.parties.includes(b))
export function warDeclared(ctx, { war }) {
  const w = W(ctx).wars.find(x => x.id === war); if (!w || w.internal) return
  w.overreach = applyOverreach(ctx, w); joinWars(ctx, w) }

// ---- recognition route (Countries kb): foreign Countries decide whether to recognise a rebel bloc. Backing a secession bid is CB-generating against the Country losing territory.
export const recognizersOf = (ctx, blocId) => D(ctx).recognition[blocId]?.recognizers ?? []
export function recognize(ctx, blocId, by) {
  const bloc = W(ctx).blocs[blocId], R = (D(ctx).recognition[blocId] ??= { recognizers: [] }); if (!R.recognizers.includes(by)) R.recognizers.push(by)
  grantCB(ctx, bloc.country, by, 'Sovereignty', 'recognized-rebels', ctx.T('cb.mag.recognize'))                         // Rule 8
  addReputation(ctx, bloc.country, by, -ctx.T('rep.recognize'), 'recognized-rebels') }
export function joinGuaranteedWars(ctx, t) {                                                                                // a guarantor of a rebel bloc enters the bloc's war against the parent
  const [guarantor, guaranteed] = t.parties, bloc = W(ctx).blocs?.[guaranteed]; if (!bloc || bloc.status !== 'active') return
  const iw = W(ctx).wars.find(w => w.internal && w.b === guaranteed && w.active); if (!iw || W(ctx).wars.some(w => !w.ended && w.chainedFrom === iw.id && w.a === guarantor)) return
  const id = ctx.nextId('w'); W(ctx).wars.push({ id, a: guarantor, b: bloc.country, active: true, startedTurn: ctx.state.meta.turn, chained: true, chainedFrom: iw.id }) }
export function onBlocEnded(ctx, blocId) {                                                                                  // the cause is resolved: chained wars end with it
  for (const w of W(ctx).wars) if (w.chained && !w.ended && W(ctx).wars.find(x => x.id === w.chainedFrom)?.b === blocId) { w.active = false; w.ended = ctx.state.meta.turn; w.result = 'cause-resolved' }
  for (const t of D(ctx).treaties) if (t.status === 'active' && partiesOf(t).includes(blocId)) t.status = 'ended' }                  // treaties still naming the bloc end with it (seceded blocs were re-keyed first)
export function onFormation(ctx, blocId, countryId) {                                                                       // Formation by secession: the bloc's treaties, recognition and grants pass to the new Country
  const rk = (ctx.state.diplomacy.rekeyed ??= {}); rk[blocId] = countryId
  for (const t of D(ctx).treaties) { for (const k of ['parties', 'imposers']) if (t[k]) t[k] = t[k].map(x => (x === blocId ? countryId : x)); for (const k of ['overlord', 'subject', 'target']) if (t[k] === blocId) t[k] = countryId }
  const R = D(ctx).recognition[blocId]; if (R) { D(ctx).recognition[countryId] = R; delete D(ctx).recognition[blocId] }
  for (const r of R?.recognizers ?? []) addReputation(ctx, r, countryId, ctx.T('recog.standing'), 'recognized-state')
  for (const g of D(ctx).grants) if (g.to === blocId) g.to = countryId }
