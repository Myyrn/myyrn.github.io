// Diplomacy: Reputational Leverage, CBs (state/event/structural), per-observer overreach, treaties + ratification, axis hooks, war chain, recognition route.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
import { makeCtx } from '../src/engine/engine.js'
import { addReputation, grantCB, decayStacks, reputation, activeCBs, leverage, greatPowerBacked } from '../src/modules/diplomacy/readouts.js'
import { value as stackValue } from '../src/kernel/modifiers.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }
const V = { kind: 'government', country: 'vantiria' }, K = { kind: 'government', country: 'kerinia' }
const gov = id => ({ kind: 'government', country: id })
const D = c => c.state.diplomacy, W = c => c.state.war
const tune = (c, k, v) => { c.ruleset.tuning[k] = { value: v, status: 'placeholder' } }
/** a province-less Country (a player one never acts on its own; set ai:true to let the AI loop see it) */
function addCountry(c, id, { titular = [id], isPlayer = true } = {}) {
  c.state.countries[id] = { name: id, color: '#999', titularNations: titular, isPlayer, aiProfile: null }
  c.state.admin.governments[id] = structuredClone(c.state.admin.governments.vantiria); c.state.polity.law[id] = structuredClone(c.state.polity.law.vantiria) }
const treaty = (c, t) => { const x = { id: `t${D(c).treaties.length}x`, status: 'active', since: 0, axes: [], ...t }; D(c).treaties.push(x); return x }
const cellIn = (c, country, province) => { const r = c.state.world.regionSnapshot.assignment[province]; return Object.values(c.state.polity.cells).find(x => x.region === r && x.estate === 'peasants' && x.nation === (country === 'vantiria' ? 'vantir' : 'kerin')) }
const X = c => makeCtx(c.state, c.ruleset, { modules: c.modules, registry: c.registry, start: c.state })   // a ctx over the LIVE state (c.ctx() is a throwaway copy)
const rep = (c, o, s) => reputation(X(c), o, s)

test('state shape: no stored aggregate of Leverage; the four categories are readouts, scope = a Country or an alliance bloc', async () => {
  const c = await boot(); assert.deepEqual(Object.keys(D(c)).sort(), ['cbs', 'claims', 'grants', 'leverage', 'proposals', 'recognition', 'treaties'])
  const L = leverage(X(c), 'vantiria', 'kerinia'); assert.deepEqual(Object.keys(L).sort(), ['cultural', 'diplomatic', 'economic', 'military'])
  const B = leverage(X(c), 'vantiria', ['kerinia']); assert.deepEqual(Object.keys(B).sort(), ['cultural', 'diplomatic', 'economic', 'military'])
  assert.ok(L.cultural >= 0 && L.cultural <= 1)
})
test('Reputational Leverage: decaying per-(observer, subject) stack, separate from everything else; an active Alliance adds a standing bonus as a readout', async () => {
  const c = await boot(); const x = X(c); addReputation(x, 'kerinia', 'vantiria', -2, 'test')
  assert.ok(rep(c, 'kerinia', 'vantiria') < 0); assert.equal(rep(c, 'vantiria', 'kerinia'), 0, 'directional: the other way is untouched')
  const before = rep(c, 'kerinia', 'vantiria'); for (let i = 0; i < 20; i++) { c.state.meta.turn++; decayStacks(X(c)) }
  assert.ok(Math.abs(rep(c, 'kerinia', 'vantiria')) < Math.abs(before) * 0.5, 'decays')
  treaty(c, { kind: 'Alliance', tier: 'BenevolentNeutrality', parties: ['vantiria', 'kerinia'] }); assert.ok(rep(c, 'vantiria', 'kerinia') > 0, 'alliance bonus is derived from the treaty graph, never stored')
  assert.ok(!Object.keys(D(c).leverage).some(k => k === 'vantiria>kerinia'))
})
test('proposals: an AI recipient decides at once; a player recipient answers; Dependency burdens are refused; identical pending proposals are rejected', async () => {
  const c = await boot(); await c.submit({ actor: V, type: 'proposeTreaty', params: { to: 'kerinia', kind: 'Cooperation', cooperation: ['Trade', 'Scientific'] } }); await c.endTurn()
  assert.ok(D(c).treaties.some(t => t.kind === 'Cooperation' && t.status === 'active'), 'AI accepts a cooperation pact')
  await c.submit({ actor: V, type: 'proposeTreaty', params: { to: 'kerinia', kind: 'Dependency', overlord: 'vantiria', axes: ['MilitaryCap', 'TradeAccess', 'ForeignPolicy', 'DomainVeto'].map(axis => ({ axis, terms: {} })) } }); await c.endTurn()
  assert.ok(!D(c).treaties.some(t => t.kind === 'Dependency'), 'a four-axis Dependency is not freely accepted'); assert.match(D(c).rejected.at(-1).reason, /government declined/)
  c.state.countries.vantiria.isPlayer = true; c.state.countries.kerinia.isPlayer = true
  await c.submit({ actor: K, type: 'proposeTreaty', params: { to: 'vantiria', kind: 'Alliance', tier: 'Defensive' } }); await c.endTurn()
  const p = D(c).proposals.find(x => x.tier === 'Defensive'); assert.ok(p && p.status === 'pending', 'waits for the player'); assert.ok(!D(c).treaties.some(t => t.tier === 'Defensive'))
  const r = await c.submit({ actor: K, type: 'proposeTreaty', params: { to: 'vantiria', kind: 'Alliance', tier: 'Defensive' } }); await c.endTurn(); assert.equal(D(c).proposals.filter(x => x.tier === 'Defensive').length, 1, 'identical pending proposal refused')
  await c.submit({ actor: V, type: 'answerProposal', params: { id: p.id, accept: true } }); await c.endTurn()
  assert.ok(D(c).treaties.some(t => t.tier === 'Defensive' && t.status === 'active')); assert.equal(D(c).proposals.length, 0)
})
test('ratification consults the treaty Veto holders like any gated act: a cell holding Veto.treaty can refuse what the Government accepts', async () => {
  const c = await boot(); tune(c, 'treaty.axisBurden', 0); tune(c, 'treaty.cellAxisCost', 5)
  const ax = ['MilitaryCap', 'TradeAccess'].map(axis => ({ axis, terms: {} }))
  await c.submit({ actor: V, type: 'proposeTreaty', params: { to: 'kerinia', kind: 'Confederation', axes: ax } }); await c.endTurn()
  assert.ok(D(c).treaties.some(t => t.kind === 'Confederation'), 'no Veto holder: the Government decides')
  const c2 = await boot(); tune(c2, 'treaty.axisBurden', 0); tune(c2, 'treaty.cellAxisCost', 5); const cell = cellIn(c2, 'kerinia', 'p:18,10') ?? Object.values(c2.state.polity.cells).find(x => x.nation === 'kerin')
  c2.state.polity.law.kerinia.rights['Veto.treaty'] = [{ scope: { kind: 'cell', nation: cell.nation, estate: cell.estate, region: cell.region }, value: true, declaredTurn: 0 }]
  await c2.submit({ actor: V, type: 'proposeTreaty', params: { to: 'kerinia', kind: 'Confederation', axes: ax } }); await c2.endTurn()
  assert.ok(!D(c2).treaties.some(t => t.kind === 'Confederation')); assert.match(D(c2).rejected.at(-1).reason, /Veto holders refused/)
})
test('CBs: state-based while the fact holds (occupation, no timer); structural derived (claims, nationalism, militaristic); event-based decay and persistence scales with tier', async () => {
  const c = await boot(), x = () => X(c); assert.deepEqual(activeCBs(x(), 'vantiria', 'kerinia').filter(b => b.class !== 'structural'), [])
  const p = Object.keys(c.state.world.provinces).find(q => c.state.world.provinces[q].owner === 'vantiria'); W(c).occupations[p] = { occupier: 'kerinia', since: 0 }
  assert.ok(activeCBs(x(), 'vantiria', 'kerinia').some(b => b.reason === 'occupied-territory' && b.tier === 'Sovereignty' && b.class === 'state')); for (let i = 0; i < 50; i++) { c.state.meta.turn++; decayStacks(x()) }
  assert.ok(activeCBs(x(), 'vantiria', 'kerinia').some(b => b.reason === 'occupied-territory'), 'no timer'); delete W(c).occupations[p]
  assert.ok(!activeCBs(x(), 'vantiria', 'kerinia').some(b => b.reason === 'occupied-territory'))
  const kp = Object.keys(c.state.world.provinces).find(q => c.state.world.provinces[q].owner === 'kerinia'); D(c).claims.push({ holder: 'vantiria', target: 'kerinia', province: kp })
  assert.ok(activeCBs(x(), 'vantiria', 'kerinia').some(b => b.reason === 'claim' && b.class === 'structural'))
  for (let i = 0; i < 3; i++) W(c).wars.push({ id: `wm${i}`, a: 'vantiria', b: `z${i}`, active: false, ended: 1 }); assert.ok(activeCBs(x(), 'vantiria', 'anyone').some(b => b.reason === 'militaristic-disposition'), 'a standing CB against ANY target')
  grantCB(x(), 'kerinia', 'vantiria', 'Grievance', 'insult'); grantCB(x(), 'kerinia', 'vantiria', 'Sovereignty', 'veto-break')
  for (let i = 0; i < 30; i++) { c.state.meta.turn++; decayStacks(x()) }
  const left = activeCBs(x(), 'kerinia', 'vantiria').filter(b => b.class === 'event'); assert.ok(left.some(b => b.tier === 'Sovereignty') && !left.some(b => b.tier === 'Grievance'), 'Grievance fades first, Sovereignty outlasts it')
})
test('Sanctions: ad hoc ones give the target a Grievance CB, great-power-backed ones do not; stripsCB removes external recognition of the target\'s CBs', async () => {
  const c = await boot(); await c.submit({ actor: V, type: 'imposeSanction', params: { target: 'kerinia', axes: [{ axis: 'ResourceExportBan', terms: { good: 'Grain' } }] } }); await c.endTurn()
  const s = D(c).treaties.find(t => t.kind === 'Sanction'); assert.ok(s); assert.ok(activeCBs(X(c), 'kerinia', 'vantiria').some(b => b.reason === 'ad-hoc-sanction' && b.tier === 'Grievance'))
  const c2 = await boot(); tune(c2, 'gp.share', 0.0001); await c2.submit({ actor: V, type: 'imposeSanction', params: { target: 'kerinia', axes: [{ axis: 'ResourceExportBan', terms: { good: 'Grain' } }] } }); await c2.endTurn()
  assert.ok(D(c2).treaties.find(t => t.kind === 'Sanction').backed); assert.ok(!activeCBs(X(c2), 'kerinia', 'vantiria').some(b => b.reason === 'ad-hoc-sanction'))
  const c3 = await boot(); grantCB(X(c3), 'kerinia', 'vantiria', 'Rights', 'broken-treaty'); assert.equal(activeCBs(X(c3), 'kerinia', 'vantiria')[0].recognised, true)
  await c3.submit({ actor: V, type: 'imposeSanction', params: { target: 'kerinia', stripsCB: true, axes: [{ axis: 'TradeAccess', terms: {} }] } }); await c3.endTurn()
  assert.equal(activeCBs(X(c3), 'kerinia', 'vantiria').find(b => b.reason === 'broken-treaty').recognised, false, 'externally stripped; the target\'s own population still recognises it')
})
test('overreach is judged against the goals claimed and applied PER OBSERVER, scaled by closeness to the victim — never global', async () => {
  const c = await boot(); addCountry(c, 'dorn'); addCountry(c, 'far'); treaty(c, { kind: 'Alliance', tier: 'Defensive', parties: ['dorn', 'kerinia'] })
  c.state.countries.vantiria.isPlayer = true
  await c.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia', goals: [{ type: 'annex' }] } }); await c.endTurn()
  const w = W(c).wars.find(x => x.a === 'vantiria' && x.b === 'kerinia' && !x.chained); assert.ok(w.overreach.kerinia > w.overreach.dorn && w.overreach.dorn > 0, 'victim > close ally')
  assert.ok(!('far' in w.overreach), 'a distant observer takes no hit'); assert.ok(rep(c, 'kerinia', 'vantiria') < rep(c, 'dorn', 'vantiria') && rep(c, 'dorn', 'vantiria') < 0 && rep(c, 'far', 'vantiria') === 0)
  const c2 = await boot(); const kp = Object.keys(c2.state.world.provinces).find(q => c2.state.world.provinces[q].owner === 'kerinia'); D(c2).claims.push({ holder: 'vantiria', target: 'kerinia', province: kp })
  await c2.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia', goals: [{ type: 'cede', province: kp }] } }); await c2.endTurn()      // Rights-tier goal, Rights-tier CB: proportionate
  assert.deepEqual(W(c2).wars.find(x => !x.chained).overreach, {})
})
test('war chain = treaty-graph propagation: Guarantee and Defensive defend, StandingOffensive/Coalition follow the attacker, Defensive needs a recognised cause, treaties forbid wars between partners', async () => {
  const c = await boot(); for (const id of ['g', 'd', 'o', 'k']) addCountry(c, id); c.state.countries.vantiria.isPlayer = true
  treaty(c, { kind: 'Alliance', tier: 'Guarantee', parties: ['g', 'kerinia'] }); treaty(c, { kind: 'Alliance', tier: 'Defensive', parties: ['d', 'vantiria'] })
  treaty(c, { kind: 'Alliance', tier: 'StandingOffensive', parties: ['o', 'vantiria'] }); treaty(c, { kind: 'Alliance', tier: 'Coalition', parties: ['k', 'vantiria'], against: 'kerinia' })
  const kp = Object.keys(c.state.world.provinces).find(q => c.state.world.provinces[q].owner === 'kerinia'); D(c).claims.push({ holder: 'vantiria', target: 'kerinia', province: kp })     // a recognised Rights CB
  await c.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia', goals: [{ type: 'cede' }] } }); await c.endTurn()
  const pairs = W(c).wars.filter(w => w.chained).map(w => `${w.a}>${w.b}`).sort()
  for (const e of ['g>vantiria', 'd>kerinia', 'o>kerinia', 'k>kerinia']) assert.ok(pairs.some(p => p === e || p === e.split('>').reverse().join('>')), `${e} in ${pairs}`)
  assert.ok(W(c).wars.filter(w => w.chained).every(w => w.chainedFrom)); for (let i = 0; i < 2; i++) await c.endTurn(); assert.ok(W(c).wars.filter(w => w.chained).every(w => w.active), 'chained wars begin hostilities')
  // Defensive ally of the attacker is NOT pulled in when the attacker's cause is stripped/absent? (no CB at all = not a recognised cause)
  const c2 = await boot(); for (const id of ['d']) addCountry(c2, id); c2.state.countries.vantiria.isPlayer = true; treaty(c2, { kind: 'Alliance', tier: 'Defensive', parties: ['d', 'vantiria'] })
  await c2.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia', goals: [{ type: 'annex' }] } }); await c2.endTurn()
  assert.ok(!W(c2).wars.some(w => w.chained && [w.a, w.b].includes('d')), 'no recognised CB -> the attacker\'s Defensive ally stays out')
  const c3 = await boot(); treaty(c3, { kind: 'Alliance', tier: 'BenevolentNeutrality', parties: ['vantiria', 'kerinia'] })
  await c3.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia' } }); const r = await c3.endTurn(); assert.equal(r.report.rejected.length, 1, 'non-aggression forbids it'); assert.equal(W(c3).wars.length, 0)
})
test('denouncing a treaty is a broken promise: reputation loss with the other party, an event-based CB held by the wronged party; lifting a Sanction is no breach', async () => {
  const c = await boot(); const t = treaty(c, { kind: 'Alliance', tier: 'Defensive', parties: ['vantiria', 'kerinia'] }); await c.submit({ actor: V, type: 'denounceTreaty', params: { id: t.id } }); await c.endTurn()
  assert.equal(D(c).treaties.find(x => x.id === t.id).status, 'broken'); assert.ok(activeCBs(X(c), 'kerinia', 'vantiria').some(b => b.reason === 'broken-treaty' && b.tier === 'Rights')); assert.ok(rep(c, 'kerinia', 'vantiria') < 0)
  const d = treaty(c, { kind: 'Dependency', overlord: 'vantiria', subject: 'kerinia', parties: ['vantiria', 'kerinia'], axes: [{ axis: 'MilitaryCap', terms: {} }] })
  await c.submit({ actor: K, type: 'denounceTreaty', params: { id: d.id } }); await c.endTurn(); assert.ok(activeCBs(X(c), 'vantiria', 'kerinia').some(b => b.reason === 'broken-treaty' && b.tier === 'Sovereignty'), 'declaring independence breaks a Sovereignty-tier promise')
  const c2 = await boot(); const s = treaty(c2, { kind: 'Sanction', imposers: ['vantiria'], target: 'kerinia', axes: [{ axis: 'TradeAccess', terms: {} }] }); await c2.submit({ actor: V, type: 'denounceTreaty', params: { id: s.id } }); await c2.endTurn()
  assert.equal(D(c2).treaties.find(x => x.id === s.id).status, 'ended'); assert.equal(activeCBs(X(c2), 'kerinia', 'vantiria').filter(b => b.class === 'event').length, 0)
})
test('axis hooks: MilitaryCap bounds fielding, ResourceExportBan/TradeAccess zero the edge, DomainVeto is a foreign Veto that cannot be forced, ForeignPolicy needs the grantee\'s consent', async () => {
  const c = await boot(); treaty(c, { kind: 'Dependency', overlord: 'kerinia', subject: 'vantiria', parties: ['kerinia', 'vantiria'], axes: [{ axis: 'MilitaryCap', terms: { maxMen: 10 } }] })
  const cell = cellIn(c, 'vantiria', 'p:7,6'); await c.submit({ actor: V, type: 'fieldUnits', params: { originCell: cell.key, composition: { 'Shock Infantry': 5 }, at: 'p:7,6' } }); await c.submit({ actor: V, type: 'fieldUnits', params: { originCell: cell.key, composition: { 'Shock Infantry': 20 }, at: 'p:7,6' } })
  const r = await c.endTurn(); assert.equal(r.report.rejected.length, 1); assert.match(r.report.rejected[0].reasons[0], /MilitaryCap/)
  const e = await boot(); const vp = Object.keys(e.state.world.provinces).find(q => e.state.world.provinces[q].owner === 'vantiria'), kp = Object.keys(e.state.world.provinces).find(q => e.state.world.provinces[q].owner === 'kerinia')
  treaty(e, { kind: 'Sanction', imposers: ['vantiria'], target: 'kerinia', axes: [{ axis: 'ResourceExportBan', terms: { good: 'Grain' } }, { axis: 'TradeAccess', terms: { embargo: 'vantiria' } }] })
  assert.equal(X(e).derive.diplomacy.tradeFactor(vp, kp, 'Grain'), 0); assert.equal(X(e).derive.diplomacy.tradeFactor(vp, kp, 'Salt'), 0, 'TradeAccess embargo covers every good'); assert.equal(X(e).derive.diplomacy.tradeFactor(vp, vp, 'Grain'), 1); for (let i = 0; i < 3; i++) await e.endTurn()
  const v = await boot(); addCountry(v, 'dorn'); treaty(v, { kind: 'Dependency', overlord: 'dorn', subject: 'vantiria', parties: ['dorn', 'vantiria'], axes: [{ axis: 'DomainVeto', terms: { domains: ['taxLaw'] } }] })
  addReputation(X(v), 'dorn', 'vantiria', -3, 't'); const tl = { actor: V, type: 'setTaxLaw', params: { scope: { kind: 'empire' }, market: 0.2, wealth: 0 } }
  await v.submit({ ...tl, forceThroughControl: true }); const rv = await v.endTurn(); assert.equal(rv.report.refused.length, 1, 'the overlord Veto blocks it and Control cannot force it'); assert.deepEqual(rv.report.refused[0].holders, ['dorn'])
  const v2 = await boot(); addCountry(v2, 'dorn'); treaty(v2, { kind: 'Dependency', overlord: 'dorn', subject: 'vantiria', parties: ['dorn', 'vantiria'], axes: [{ axis: 'DomainVeto', terms: { domains: ['taxLaw'] } }] })
  await v2.submit(tl); assert.equal((await v2.endTurn()).report.refused.length, 0, 'a grantee that holds no grudge lets it through')
  const f = await boot(); addCountry(f, 'dorn'); treaty(f, { kind: 'Dependency', overlord: 'dorn', subject: 'vantiria', parties: ['dorn', 'vantiria'], axes: [{ axis: 'ForeignPolicy', terms: {} }] })
  addReputation(X(f), 'dorn', 'vantiria', -3, 't'); f.state.countries.kerinia.isPlayer = false
  await f.submit({ actor: V, type: 'proposeTreaty', params: { to: 'kerinia', kind: 'Cooperation', cooperation: ['Trade'] } }); await f.endTurn(); assert.match(D(f).rejected.at(-1).reason, /ForeignPolicy consent withheld by dorn/)
})
test('recognition route: rebels take it (independence goal / refused), a foreign Government recognises, backing secession is CB-generating against the parent, a Guarantee pulls the guarantor into the war', async () => {
  const c = await boot(); const cell = cellIn(c, 'vantiria', 'p:5,5'); c.state.polity.law.vantiria.rights.Retinue = [{ scope: { kind: 'cell', nation: cell.nation, estate: cell.estate, region: cell.region }, value: 0.5, declaredTurn: 0 }]
  cell.grievance.identity_autonomy = 0.95; c.state.polity.rung[`${cell.key}|identity_autonomy`] = 4; c.state.polity.momentum[`${cell.key}|identity_autonomy`] = 3; c.state.admin.governments.vantiria.controlSupply = 0; tune(c, 'civil.secede.turns', 99); tune(c, 'civil.calm.turns', 99)
  await c.endTurn(); const b = Object.values(W(c).blocs)[0]; assert.ok(b)
  await c.submit({ actor: V, type: 'recognizeBloc', params: { bloc: b.id } }); assert.equal((await c.endTurn()).report.rejected.length, 1, 'the parent cannot recognise its own rebels')
  await c.submit({ actor: K, type: 'recognizeBloc', params: { bloc: b.id } }); await c.endTurn()
  assert.deepEqual(D(c).recognition[b.id].recognizers, ['kerinia']); assert.ok(activeCBs(X(c), 'vantiria', 'kerinia').some(x => x.reason === 'recognized-rebels' && x.tier === 'Sovereignty'), 'Rule 8: backing secession is CB-generating'); assert.ok(rep(c, 'vantiria', 'kerinia') < 0)
  await c.submit({ actor: K, type: 'recognizeBloc', params: { bloc: b.id } }); assert.equal((await c.endTurn()).report.rejected.length, 1, 'already recognised')
  await c.submit({ actor: K, type: 'proposeTreaty', params: { to: b.id, kind: 'Alliance', tier: 'Guarantee', guarantor: 'kerinia' } }); await c.endTurn()
  const g = D(c).treaties.find(t => t.tier === 'Guarantee'); assert.deepEqual(g.parties, ['kerinia', b.id]); const chained = W(c).wars.find(w => w.chained && w.a === 'kerinia' && w.b === 'vantiria'); assert.ok(chained && chained.active, 'the guarantor entered the bloc\'s war')
  const w = W(c).wars.find(x => x.internal); tune(c, 'civil.concession', 1)
  await c.submit({ actor: V, type: 'proposePeace', params: { war: w.id, terms: { concessions: [{ kind: 'rights', id: 'Council', scope: { kind: 'estate', estate: 'peasants' }, value: true }] } } }); await c.endTurn()
  assert.equal(W(c).wars.find(x => x.internal).lastProposal.accepted, false, 'a recognised bloc holds out for independence')
  tune(c, 'civil.secedeValue', 2)
  await c.submit({ actor: V, type: 'proposePeace', params: { war: w.id, terms: { secede: true } } }); await c.endTurn()
  const fin = Object.values(W(c).blocs)[0]; assert.equal(fin.status, 'seceded'); const nid = fin.country2
  assert.deepEqual(D(c).treaties.find(t => t.id === g.id).parties, ['kerinia', nid], 'the Guarantee passes to the new Country'); assert.deepEqual(D(c).recognition[nid].recognizers, ['kerinia']); assert.ok(rep(c, 'kerinia', nid) > 0)
  assert.ok(W(c).wars.find(x => x.id === chained.id).ended, 'chained war ends with its cause'); for (let i = 0; i < 4; i++) await c.endTurn()
})
test('recognition is only open to rebels who took the route (a concession-seeking bloc is not recognisable until refused); AI kin-states recognise and guarantee on their own', async () => {
  const c = await boot(); const cell = cellIn(c, 'vantiria', 'p:5,5'); c.state.polity.law.vantiria.rights.Retinue = [{ scope: { kind: 'cell', nation: cell.nation, estate: cell.estate, region: cell.region }, value: 0.5, declaredTurn: 0 }]
  tune(c, 'civil.revolt', 3); cell.grievance.fairness = 0.95; c.state.polity.rung[`${cell.key}|fairness`] = 4; c.state.polity.momentum[`${cell.key}|fairness`] = 3; c.state.admin.governments.vantiria.controlSupply = 0; tune(c, 'civil.calm.turns', 99)
  await c.endTurn(); const b = Object.values(W(c).blocs)[0]; assert.equal(b.goal, 'concession')
  await c.submit({ actor: K, type: 'recognizeBloc', params: { bloc: b.id } }); assert.equal((await c.endTurn()).report.rejected.length, 1)
  const a = await boot(); a.state.countries.kerinia.titularNations = ['kerin', 'vantir']; const cl = cellIn(a, 'vantiria', 'p:5,5'); a.state.polity.law.vantiria.rights.Retinue = [{ scope: { kind: 'cell', nation: cl.nation, estate: cl.estate, region: cl.region }, value: 0.5, declaredTurn: 0 }]
  cl.grievance.identity_autonomy = 0.95; a.state.polity.rung[`${cl.key}|identity_autonomy`] = 4; a.state.polity.momentum[`${cl.key}|identity_autonomy`] = 3; a.state.admin.governments.vantiria.controlSupply = 0; tune(a, 'civil.secede.turns', 99); tune(a, 'civil.calm.turns', 99)
  for (let i = 0; i < 4; i++) await a.endTurn(); const bid = Object.keys(W(a).blocs)[0]
  assert.ok(D(a).recognition[bid]?.recognizers.includes('kerinia'), 'AI kin-state recognised'); assert.ok(D(a).treaties.some(t => t.tier === 'Guarantee' && t.parties[0] === 'kerinia' && t.parties[1] === bid), 'and offered a Guarantee, accepted by the bloc')
  assert.ok(W(a).wars.some(w => w.chained && w.a === 'kerinia' && w.b === 'vantiria'))
})
test('FacilitationGrant: a real zero-sum transfer of a good from the grantor\'s warehouse to a bloc\'s held province', async () => {
  const c = await boot(); const cell = cellIn(c, 'vantiria', 'p:5,5'); c.state.polity.law.vantiria.rights.Retinue = [{ scope: { kind: 'cell', nation: cell.nation, estate: cell.estate, region: cell.region }, value: 0.5, declaredTurn: 0 }]
  cell.grievance.identity_autonomy = 0.95; c.state.polity.rung[`${cell.key}|identity_autonomy`] = 4; c.state.polity.momentum[`${cell.key}|identity_autonomy`] = 3; c.state.admin.governments.vantiria.controlSupply = 0; await c.endTurn()
  const b = Object.values(W(c).blocs)[0], from = Object.keys(c.state.world.provinces).find(q => c.state.world.provinces[q].owner === 'kerinia' && (c.state.economy.warehouses[q]?.stock?.['Cold Weapons'] ?? 0) >= 5)
  if (!from) { const q = Object.keys(c.state.world.provinces).find(p => c.state.world.provinces[p].owner === 'kerinia' && c.state.economy.warehouses[p]); c.state.economy.warehouses[q].stock['Cold Weapons'] = 50 }
  const src = from ?? Object.keys(c.state.world.provinces).find(p => c.state.world.provinces[p].owner === 'kerinia' && (c.state.economy.warehouses[p]?.stock?.['Cold Weapons'] ?? 0) >= 5)
  const held = Object.keys(W(c).occupations).find(p => W(c).occupations[p].occupier === b.id), tot = () => Object.values(c.state.economy.warehouses).reduce((s, w) => s + (w.stock['Cold Weapons'] ?? 0), 0), before = tot(), at0 = c.state.economy.warehouses[held].stock['Cold Weapons'] ?? 0
  await c.submit({ actor: K, type: 'grantFacilitation', params: { to: b.id, from: src, good: 'Cold Weapons', qty: 5 } }); const r = await c.endTurn(); assert.equal(r.report.rejected.length, 0)
  assert.equal(D(c).grants.length, 1); assert.equal(D(c).grants[0].dest, held); assert.ok(Math.abs(tot() - before) < 5 * 3 + 1e-6, 'only the grant moved (other economy flows aside)')
})
test('demo run: diplomacy orders mid-run keep the world consistent and deterministic', async () => {
  const play = async () => { const c = await boot(); addCountry(c, 'dorn')
    await c.submit({ actor: V, type: 'proposeTreaty', params: { to: 'kerinia', kind: 'Cooperation', cooperation: ['Trade'] } }); await c.submit({ actor: V, type: 'imposeSanction', params: { target: 'kerinia', axes: [{ axis: 'ResourceExportBan', terms: { good: 'Grain' } }] } })
    for (let i = 0; i < 15; i++) { await c.endTurn(); for (const x of Object.values(c.state.polity.cells)) assert.ok(x.wealth >= 0 && x.population >= 0) } return c }
  const a = await play(), b = await play(); assert.equal(JSON.stringify(a.state), JSON.stringify(b.state))
})
