// war/internal.js — Internal Armed Conflict (war__kb "Internal Armed Conflict", "sizing and resolution"; internal_politics__kb faction ladder, top rung).
// A faction's armed rung resolves HERE on the same combat / Supply / Siege / Occupation machinery. The rebelling bloc is a war SIDE that is not a Country:
//   state.war.blocs[id] = { id, country (parent), need, goal: 'concession'|'independence', cells[] (log only), status: active|conceded|suppressed|seceded, ... }
//   a war record { a: parent, b: blocId, internal: true } makes atWar / armies / sieges / peace work unchanged. Membership is the cell flag `flags.rebel = blocId`
//   (so it survives Region re-derivation, which re-keys cells). Rebel units come ONLY from member cells' own army pools, up to the cell's scalar Retinue Right.
//   Rebel Supply: warehouses in territory the rebels control = provinces whose `occupations[p].occupier` is the bloc (their home provinces at the uprising).
// End states: concession (Government peace terms in Rights/Duties vocabulary, OR the grievance is addressed), suppression (rebels destroyed -> martial law on the
// member cells, reusing occupation's Control cost), secession (Countries Formation). No Occupation Grievance applies to a bloc's own people.
import { regionStock, takeRegionStock } from './stock.js'
import { stance, approves } from '../../kernel/stance.js'
import { applyLawEntries } from '../polity/remaining.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x))
const W = ctx => ctx.state.war, cells = ctx => ctx.state.polity.cells

export const isBloc = (ctx, id) => !!W(ctx).blocs?.[id]
/** Who actually holds a province: a bloc occupier if one holds it, else its owner. (Ordinary-war occupation keeps its original meaning: the owner stays the controller.) */
export const controller = (ctx, p) => { const o = W(ctx).occupations[p]; return o && isBloc(ctx, o.occupier) ? o.occupier : ctx.state.world.provinces[p].owner }
export const activeBlocs = ctx => Object.values(W(ctx).blocs ?? {}).filter(b => b.status === 'active').sort((a, b) => (a.id < b.id ? -1 : 1))
export const members = (ctx, bloc) => Object.values(cells(ctx)).filter(c => c.flags?.rebel === bloc.id)
const countryOfCell = (ctx, c) => ctx.derive.worldmap.regionOwner(c.region)
const strength = (ctx, owner) => sum(Object.values(W(ctx).armies).filter(a => a.owner === owner).map(a => sum(a.units.map(id => W(ctx).units[id].n))))
export const retinueScalar = (ctx, key) => clamp01(Number(ctx.derive.polity.right(key, 'Retinue') ?? 0) || 0)
const homeProvinces = (ctx, c) => ctx.derive.worldmap.regionProvinces(c.region).filter(p => ctx.derive.worldmap.presence(p, c.nation) > 0)
const armyPools = ctx => Object.entries(ctx.ruleset.pools).filter(([, v]) => v.kind === 'army').map(([k]) => k)

/** What a cell could raise as retinue now: own free army labour x its Retinue scalar, limited by Cold Weapons in its own Region (rebels arm from their own stock). */
export function retinueComposition(ctx, c) {
  const s = retinueScalar(ctx, c.key), comp = {}; let men = 0
  for (const pool of armyPools(ctx)) { const n = Math.floor(Math.max(0, (c.labour[pool] ?? 0) - (c.labourCommitted[pool] ?? 0)) * s); if (n > 0) { comp[pool] = n; men += n } }
  const budget = Math.floor(regionStock(ctx, c.region, 'Cold Weapons') / ctx.T('war.field.goodsPerMan'))
  if (men > budget) { const f = budget / men; men = 0; for (const p of Object.keys(comp)) { comp[p] = Math.floor(comp[p] * f); men += comp[p] } }
  return { comp, men } }

function ensureWar(ctx, bloc) {
  let w = W(ctx).wars.find(x => x.internal && x.b === bloc.id)
  if (!w) { w = { id: ctx.nextId('w'), a: bloc.country, b: bloc.id, active: true, internal: true, startedTurn: ctx.state.meta.turn }; W(ctx).wars.push(w) }
  return w }

function muster(ctx, c, bloc, { comp, men }) {
  if (men <= 0) return null
  takeRegionStock(ctx, c.region, 'Cold Weapons', men * ctx.T('war.field.goodsPerMan'))
  const start = ctx.derive.worldmap.regionProvinces(c.region).sort((x, y) => ctx.derive.worldmap.presence(y, c.nation) - ctx.derive.worldmap.presence(x, c.nation))[0], id = ctx.nextId('a'), units = []
  for (const [pool, n] of Object.entries(comp)) { if (n <= 0) continue; const uid = ctx.nextId('u'); c.labourCommitted[pool] = (c.labourCommitted[pool] ?? 0) + n
    W(ctx).units[uid] = { id: uid, army: id, originCell: c.key, pool, n, cohesion: 0.7, supply: 1, wounded: [] }; units.push(uid) }
  W(ctx).armies[id] = { id, owner: bloc.id, units, position: start, prev: start, destination: null, path: [], tactic: 'defensive', stance: 'hold', traits: [] }; return id }

/** A cell takes the armed rung: raise a bloc for (country, need) or join the live one; muster its retinue; seize its home provinces. */
export function raiseOrJoin(ctx, c, need) {
  const country = countryOfCell(ctx, c), B = (W(ctx).blocs ??= {})
  let bloc = activeBlocs(ctx).find(b => b.country === country && (b.need === need || c.flags?.rebel === b.id))
  if (!bloc) { const id = ctx.nextId('rb'); bloc = B[id] = { id, country, need, goal: need === 'identity_autonomy' ? 'independence' : 'concession', cells: [], formed: ctx.state.meta.turn, secure: 0, calm: 0, status: 'active' } }
  ensureWar(ctx, bloc)
  const joining = c.flags?.rebel !== bloc.id; (c.flags ??= {}).rebel = bloc.id; c.defiance = { ...(c.defiance ?? {}), tax: 1 }      // open revolt: Duties are simply not delivered
  if (!joining) return bloc
  bloc.cells.push(c.key)
  muster(ctx, c, bloc, retinueComposition(ctx, c))
  for (const p of homeProvinces(ctx, c)) if (!W(ctx).occupations[p]) { W(ctx).occupations[p] = { occupier: bloc.id, since: ctx.state.meta.turn, rebel: true }; delete W(ctx).sieges[p] }
  ctx.bump(); return bloc }

export function disbandArmies(ctx, owner) {
  for (const a of Object.values(W(ctx).armies).filter(x => x.owner === owner)) {
    for (const id of a.units) { const u = W(ctx).units[id], cell = cells(ctx)[u.originCell]; if (cell) cell.labourCommitted[u.pool] = Math.max(0, (cell.labourCommitted[u.pool] ?? 0) - u.n - sum((u.wounded ?? []).map(w => w.n))); delete W(ctx).units[id] }
    delete W(ctx).armies[a.id] } }
const releaseHeld = (ctx, id) => { for (const p of Object.keys(W(ctx).occupations)) if (W(ctx).occupations[p].occupier === id) { delete W(ctx).occupations[p]; delete W(ctx).sieges[p] } }

/** Countries Formation via secession (kb: "criteria for Formation to complete" are open; alpha rule = the bloc holds all its home provinces, free of Government armies, for civil.secede.turns). */
export function formCountry(ctx, bloc) {
  const held = Object.keys(W(ctx).occupations).filter(p => W(ctx).occupations[p].occupier === bloc.id), ms = members(ctx, bloc), parent = bloc.country
  const pop = {}; for (const c of ms) pop[c.nation] = (pop[c.nation] ?? 0) + c.population
  const nation = Object.entries(pop).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'rebels', id = `free-${bloc.id}`
  ctx.state.countries[id] = { name: `Free ${nation}`, color: '#7f8c8d', titularNations: [nation], isPlayer: false, aiProfile: null, formedFrom: parent, formedTurn: ctx.state.meta.turn }
  ctx.state.admin.governments[id] = { ledger: 0, spendingDial: { entries: [] }, controlDial: { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] }, observationDial: { entries: [] }, inventory: {}, upkeepFraction: 0 }
  ctx.state.polity.law[id] = structuredClone(ctx.state.polity.law[parent] ?? { rights: {}, duties: {}, requisitions: [] })              // the new Country starts with the parent's law
  for (const p of held) { ctx.state.world.provinces[p].owner = id; delete W(ctx).occupations[p] }                                       // Regions re-derive at step 8
  for (const a of Object.values(W(ctx).armies)) if (a.owner === bloc.id) a.owner = id
  for (const c of ms) { c.defiance = {}; delete c.flags.rebel }
  ctx.services.diplomacy?.onFormation(bloc.id, id)                                                                                          // recognition / Guarantees pass to the new Country
  ctx.bump(); return id }

export function endBloc(ctx, bloc, how) {
  const ms = members(ctx, bloc), w = W(ctx).wars.find(x => x.internal && x.b === bloc.id)
  if (how === 'seceded') bloc.country2 = formCountry(ctx, bloc)
  else { disbandArmies(ctx, bloc.id); releaseHeld(ctx, bloc.id); for (const c of ms) { delete c.flags.rebel; c.defiance = {} } }
  ctx.services.diplomacy?.onBlocEnded(bloc.id)                                                                                              // chained foreign wars end with their cause
  bloc.status = how; bloc.ended = ctx.state.meta.turn; if (w) { w.active = false; w.ended = ctx.state.meta.turn; w.result = how }
  if (how === 'suppressed') for (const c of ms) { (c.flags ??= {}).martialLaw = { since: ctx.state.meta.turn, until: ctx.state.meta.turn + ctx.T('civil.martial.turns') }    // civil-war martial law: same Control cost as occupation
    c.opinionGovMods.push({ id: `suppress.${ctx.state.meta.turn}`, value: -ctx.T('civil.suppress.opinion'), decay: { kind: 'exp', rateKey: 'demo.opinionDecay' }, turn: ctx.state.meta.turn }) }
  ctx.bump() }

/** Control the Government spends holding suppressed cells (read by Administration.controlSupply). */
export const martialCost = (ctx, country) => ctx.T('war.martialLaw.control') * sum(Object.values(cells(ctx)).filter(c => c.flags?.martialLaw && countryOfCell(ctx, c) === country).map(c => c.population))

/** War step 4, after movement/supply/clashes/sieges/recovery. */
export function stepInternal(ctx) {
  const T = ctx.T, turn = ctx.state.meta.turn
  for (const c of Object.values(cells(ctx))) if (c.flags?.martialLaw && c.flags.martialLaw.until <= turn) delete c.flags.martialLaw
  for (const bloc of activeBlocs(ctx)) {
    const ms = members(ctx, bloc), armies = Object.values(W(ctx).armies).filter(a => a.owner === bloc.id), held = Object.keys(W(ctx).occupations).filter(p => W(ctx).occupations[p].occupier === bloc.id)
    if (!armies.length && !held.length) { endBloc(ctx, bloc, 'suppressed'); continue }                                   // rebels destroyed and nothing held: the Government won
    bloc.calm = ms.length && ms.every(c => (ctx.state.polity.rung[`${c.key}|${bloc.need}`] ?? 0) === 0) ? bloc.calm + 1 : 0
    if (bloc.calm >= T('civil.calm.turns')) { endBloc(ctx, bloc, 'conceded'); continue }                                 // grievance addressed -> the conflict ends
    if (bloc.goal === 'independence') {
      const home = [...new Set(ms.flatMap(c => homeProvinces(ctx, c)))], loyal = Object.values(W(ctx).armies).filter(a => a.owner === bloc.country).map(a => a.position)
      bloc.secure = home.length && home.every(p => held.includes(p) && !loyal.includes(p)) ? bloc.secure + 1 : 0
      if (bloc.secure >= T('civil.secede.turns')) endBloc(ctx, bloc, 'seceded') } } }

// ---- Rebel Peace Conference: the SAME capability-assessment conference; terms use Internal Politics' vocabulary (concessions = Rights/Duties entries, secession = Formation).
const num = v => (typeof v === 'number' ? v : v && typeof v === 'object' ? sum(Object.values(v)) : v ? 1 : 0)
export function concessionValue(ctx, bloc, entries) {
  const ms = members(ctx, bloc); if (!entries.length || !ms.length) return 0; let good = 0
  for (const e of entries) { const key = ms[0].key, cur = e.kind === 'rights' ? ctx.derive.polity.right(key, e.id) : ctx.derive.polity.duty(key, e.id, 0), after = e.value === null ? 0 : e.value
    if (e.kind === 'rights' ? num(after) > num(cur) : num(after) < num(cur)) good++ }
  return good / entries.length }
export function internalPeaceEvaluation(ctx, bloc, terms) {
  const own = strength(ctx, bloc.id), foe = strength(ctx, bloc.country), ms = members(ctx, bloc), harm = sum(ms.map(c => c.warHarm ?? 0)) / (ms.length || 1), T = ctx.T
  return stance(bloc.id, terms, ctx, { selfInterest: () => (0.5 - own / (own + foe + 1e-9)) + T('war.peace.exh') * harm + T('civil.concession') * concessionValue(ctx, bloc, terms.concessions ?? [])
      + (bloc.goal === 'independence' ? (terms.secede ? T('civil.secedeValue') : -T('civil.independenceHold')) : 0) - T('recog.hold') * (ctx.derive.diplomacy?.recognizersOf(bloc.id).length ?? 0), modifier: () => 1 }) }
export function resolveInternalPeace(ctx, w, terms) {
  const bloc = W(ctx).blocs[w.b]; if (!bloc || bloc.status !== 'active') return
  const ok = approves(internalPeaceEvaluation(ctx, bloc, terms), ctx); w.lastProposal = { turn: ctx.state.meta.turn, accepted: ok }; if (!ok) return
  if (terms.concessions?.length) applyLawEntries(ctx, bloc.country, terms.concessions)                              // Rights/Duties Events (accepted at the table; see Status for gating)
  endBloc(ctx, bloc, terms.secede ? 'seceded' : 'conceded') }

// ---- the armed rung as a cell action
export function registerInternalActions(reg) {
  reg.register({ id: 'armedRevolt', module: 'war', class: 'commitment', cellAvailability: 'permitted', minRung: 0, defaultVisibility: 'public', costs: () => [], axisLoads: { ruthlessness_restraint: -1 },
    // availability: `granted` in kind (needs the scalar Retinue Right > 0 and men to field) — checked here because the registry's `granted` gate is boolean-only
    propose: (ctx, key) => { const c = cells(ctx)[key]; if (!c || c.flags?.martialLaw) return null
      if (c.flags?.rebel && W(ctx).blocs?.[c.flags.rebel]?.status === 'active') return { continuing: true, need: W(ctx).blocs[c.flags.rebel].need }
      const need = Object.keys(ctx.state.polity.rung ?? {}).filter(k => k.startsWith(key + '|') && ctx.state.polity.rung[k] >= 4).map(k => k.split('|')[3]).sort((a, b) => (c.grievance?.[b] ?? 0) - (c.grievance?.[a] ?? 0))[0]
      return need && retinueComposition(ctx, c).men >= ctx.T('civil.minMen') ? { need } : null },
    utility: (ctx, key, p) => { if (p.continuing) return 10; const c = cells(ctx)[key], inv = ctx.derive.polity.compliance(key).involuntary
      return ctx.T('civil.revolt') * (c.grievance?.[p.need] ?? 0) * (1 - inv) - ctx.T('defy.risk') * inv },
    validate: () => ({ ok: true }), apply: (ctx, a) => { raiseOrJoin(ctx, cells(ctx)[a.actor.key], a.params.need) } })
}
