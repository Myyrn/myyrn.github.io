// ui/debugShell.js — minimal launchable shell. Reads ONLY through EngineClient; holds no game state.
import { readPackage } from '../data/loaders/readPackage.js'
import { EngineClient } from '../client/engineClient.js'
import { TERRAIN, SURFACE, geometry as geom, hexPath, pickHex, drawEdges } from './hexmap.js'
import { loadPackage } from '../editor/bundle.js'
const $ = id => document.getElementById(id), fmt = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : x)
const params = new URLSearchParams(location.search), scn = params.get('scenario') ?? 'demo'
const readJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() }
const client = new EngineClient(); let map, cells = [], selected = null, queued = [], armies = [], wars = []
const LENSES = { Terrain: 'terrain', Owner: 'owner', Subsistence: 'subsistence', Grievance: 'grievance', Population: 'population' }
async function boot() {
  let pkg, ruleset
  if (scn.startsWith('idb:')) { const docs = await loadPackage(scn.slice(4)); if (!docs) throw new Error(`no saved package ${scn}`); ({ ruleset, ...pkg } = docs) }   // launched from the Editor
  else { pkg = await readPackage(readJson, `scenarios/${scn}`); ruleset = await readJson('data/ruleset.json') }
  await client.init(pkg, ruleset); $('scn').textContent = pkg.manifest.name
  const cs = pkg.countries.countries; for (const [id, c] of Object.entries(cs)) $('country').add(new Option(c.name, id)); $('country').value = pkg.scenario.playerCountry
  for (const k of Object.keys(LENSES)) $('lens').add(new Option(k, k)); $('lens').value = 'Owner'
  for (const g of Object.keys(ruleset.goods).filter(g => ['raw', 'semi'].includes(ruleset.goods[g].tier))) $('reqgood').add(new Option(g, g))
  $('reqgood').value = 'Grain'
  for (const id of ['country', 'lens']) $(id).onchange = refresh
  $('end').onclick = async () => { await run(1) }; $('run10').onclick = async () => { await run(10) }
  $('qtax').onclick = () => queue({ actor: { kind: 'government', country: $('country').value }, type: 'setTaxLaw', params: { market: +$('taxm').value, wealth: +$('taxw').value } })
  $('qreq').onclick = () => queue({ actor: { kind: 'government', country: $('country').value }, type: 'placeRequisition', params: { good: $('reqgood').value, amount: +$('reqamt').value } })
  $('qctl').onclick = () => queue({ actor: { kind: 'government', country: $('country').value }, type: 'setControlAllocation', params: { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] } })
  $('clear').onclick = async () => { await client.clearOrders(); queued = []; renderOrders() }
  const me = () => ({ kind: 'government', country: $('country').value }), other = () => Object.keys(map.countries).find(x => x !== $('country').value)
  $('qwar').onclick = () => queue({ actor: me(), type: 'declareWar', params: { target: other() } })
  $('qpeace').onclick = async () => { const w = (await client.query('wars')).find(x => x.active && !x.ended); if (!w || !selected) return; const owner = map.provinces[selected].owner
    queue({ actor: me(), type: 'proposePeace', params: { war: w.id, terms: { cede: owner === $('country').value ? [] : [{ province: selected, from: owner, to: $('country').value }] } } }) }
  $('qfield').onclick = () => { if (!selected) return; const rid = map.regions[selected], cell = cells.find(x => x.key.split('|')[2] === rid && x.key.split('|')[1] === 'peasants' && map.provinces[selected].owner === $('country').value)
    if (!cell) return alert('select one of your provinces with a peasant cell'); const free = Math.floor(cell.freeShock * 0.5)
    queue({ actor: me(), type: 'fieldUnits', params: { originCell: cell.key, composition: { 'Shock Infantry': free }, at: selected } }) }
  $('qmove').onclick = () => { if (selected && $('armysel').value) queue({ actor: me(), type: 'orderMove', params: { armyId: $('armysel').value, to: selected } }) }
  $('qtactic').onclick = () => { if ($('armysel').value) queue({ actor: me(), type: 'setTactic', params: { armyId: $('armysel').value, tactic: $('tactic').value } }) }
  $('map').onclick = e => pick(e); await refresh()
}
async function queue(o) { await client.submit(o); queued.push(o); renderOrders() }
const renderOrders = () => { $('orders').textContent = queued.length ? queued.map(o => `${o.actor.country}: ${o.type} ${JSON.stringify(o.params).slice(0, 60)}`).join('\n') : 'no orders queued'; $('orders').style.whiteSpace = 'pre-wrap' }
async function run(n) { $('status').textContent = 'resolving…'; let rep
  for (let i = 0; i < n; i++) { rep = (await client.endTurn()).report; queued = [] }
  $('report').textContent = `executed ${rep.executed.length}, rejected ${rep.rejected.length}${rep.rejected.length ? ' (' + rep.rejected.map(r => r.type + ': ' + r.reasons.join(',')).join('; ') + ')' : ''}, refused ${rep.refused.length}`
  renderOrders(); $('status').textContent = ''; await refresh() }
async function refresh() {
  const c = $('country').value; map = await client.query('map'); cells = await client.query('cells'); armies = await client.query('armies'); wars = await client.query('wars'); const st = client.snapshotMeta(); $('turn').textContent = st.turn
  drawMap(); const mineA = armies.filter(a => a.owner === c); $('armysel').innerHTML = ''; for (const a of mineA) $('armysel').add(new Option(`${a.id} @${a.position} (${a.men})`, a.id))
  $('wars').textContent = wars.length ? wars.map(w => `${w.a} vs ${w.b}: ${w.ended != null ? 'ended t' + w.ended : w.active ? 'ACTIVE' : 'declared'}${w.lastProposal ? ' · last peace proposal ' + (w.lastProposal.accepted ? 'accepted' : 'refused') : ''} · occupied provinces ${w.occupations}`).join('\n') : 'no wars'; $('wars').style.whiteSpace = 'pre-wrap'
  $('armies').innerHTML = '<tr><th>army</th><th>owner</th><th>at</th><th>men</th><th>coh.</th><th>supply</th></tr>' + armies.map(a => `<tr><td>${a.id}</td><td>${a.owner}</td><td>${a.position}→${a.destination ?? '—'}</td><td>${a.men}</td><td>${a.cohesion}</td><td>${a.supply}</td></tr>`).join('')
  const gov = await client.query('government', { country: c }), law = await client.query('law', { country: c })
  const tax = (law.duties.Taxation ?? []).map(e => `${e.scope.kind}: market ${e.value.market}, wealth ${e.value.wealth}`).join('; ') || 'none'
  $('gov').innerHTML = `Ledger <b>${fmt(gov.ledger, 0)}</b> · upkeep unmet ${fmt(gov.upkeepFraction)}<br>Tax law: ${tax}<br>Requisitions: ${(law.requisitions ?? []).map(r => r.target.good + ' ' + r.amount).join(', ') || 'none'}<br>Inventory: ${Object.entries(gov.inventory ?? {}).map(([g, q]) => g + ' ' + Math.round(q)).join(', ') || '—'}`
  const mine = cells.filter(x => map.provinces[Object.keys(map.regions).find(p => map.regions[p] === x.key.split('|')[2])]?.owner === c)
  $('cells').innerHTML = '<tr><th>cell</th><th>pop</th><th>wealth</th><th>subs</th><th>grievance</th><th>compl.</th><th>rung</th></tr>' + mine.map(x => `<tr><td>${x.key}</td><td>${x.population}</td><td>${x.wealth}</td><td>${fmt(x.satisfaction.subsistence)}</td><td>${fmt(x.grievance.subsistence ?? 0)}</td><td>${fmt(x.compliance.total)}</td><td>${x.rung}</td></tr>`).join('')
  const h = await client.query('history'); $('hist').innerHTML = '<tr><th>turn</th><th>subsistence</th><th>grievance</th><th>ledger</th><th>Q</th></tr>' + h.slice(-12).map(s => { const v = s.countries[c]; return `<tr><td>${s.turn}</td><td>${fmt(v.subsistence)}</td><td>${fmt(v.grievance)}</td><td>${fmt(v.ledger, 0)}</td><td>${v.questions}</td></tr>` }).join('')
  if (selected) showProv(selected) }
const geometry = () => geom(map.grid)
function lerpColor(t) { const a = [60, 140, 80], b = [200, 60, 40], m = a.map((v, i) => Math.round(v + (b[i] - v) * t)); return `rgb(${m})` }
function provValue(p, kind) { const rid = map.regions[p]; const cs = cells.filter(x => x.key.split('|')[2] === rid), pop = cs.reduce((s, x) => s + x.population, 0) || 1
  if (kind === 'subsistence') return 1 - cs.reduce((s, x) => s + x.satisfaction.subsistence * x.population, 0) / pop
  if (kind === 'grievance') return cs.reduce((s, x) => s + (x.grievance.subsistence ?? 0) * x.population, 0) / pop
  return map.provinces[p].population / 500 }
function drawMap() { const cv = $('map'), g = geometry(), ctx = cv.getContext('2d'), lens = LENSES[$('lens').value]; cv.width = g.W; cv.height = g.H; ctx.clearRect(0, 0, g.W, g.H)
  for (const h of Object.values(map.hexes)) { const [cx, cy] = g.ctr(h.x, h.y), id = `p:${h.x},${h.y}`, p = map.provinces[id]
    const col = h.surface !== 'land' ? SURFACE[h.surface] : lens === 'terrain' ? TERRAIN[p.terrain] : lens === 'owner' ? (map.countries[p.owner]?.color ?? '#999') : lerpColor(Math.min(1, provValue(id, lens)))
    hexPath(ctx, cx, cy, g.s); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = selected === id ? '#fff' : 'rgba(0,0,0,.25)'; ctx.lineWidth = selected === id ? 3 : 1; ctx.stroke() }
  for (const a of armies) { const [x, y] = a.position.slice(2).split(',').map(Number), [cx, cy] = g.ctr(x, y); ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fillStyle = map.countries[a.owner].color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke() }
  drawEdges(ctx, g, Object.values(map.edges)) }
function pick(e) { const best = pickHex($('map'), e, map.grid, map.hexes); if (best && map.provinces[`p:${best.x},${best.y}`]) { selected = `p:${best.x},${best.y}`; drawMap(); showProv(selected) } }
function showProv(id) { const p = map.provinces[id], rid = map.regions[id]
  $('prov').innerHTML = `<b>${id}</b> · ${p.terrain} · forest ${p.forestation}% · ${p.habitability} · water ${p.waterSource}<br>owner ${map.countries[p.owner].name} · region ${rid} · population ${p.population} · infra ${p.infrastructureLevel} / trade ${p.tradeInfrastructureLevel}` }
boot().catch(e => { $('status').textContent = 'error: ' + e.message; console.error(e) })
