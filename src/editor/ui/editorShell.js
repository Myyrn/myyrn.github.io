// editor/ui/editorShell.js — out-of-game Scenario Editor. All edits go through EditorStore (patches, undo/redo); no direct document mutation.
import { EditorStore } from '../store.js'
import * as C from '../commands.js'
import { GENERATORS } from '../generators.js'
import { exportBundle, importBundle, savePackage, loadPackage, listPackages } from '../bundle.js'
import { newPackage } from '../templates.js'
import { readPackage } from '../../data/loaders/readPackage.js'
import { worklist } from '../../data/validators/index.js'
import { DOC_SCHEMAS } from '../../data/schemas/index.js'
import { EngineClient } from '../../client/engineClient.js'
import { TERRAIN, SURFACE, geometry, hexPath, pickHex, drawEdges } from '../../ui/hexmap.js'
import { ptr } from '../patch.js'
const $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const readJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() }
const TABS = ['Overview', 'Map', 'Tables', 'Nations & Countries', 'Generators', 'Validation', 'Playtest']
let store = null, tab = 'Overview', tool = 'select', toolArg = {}, selected = null, edgeA = null, table = 'goods', filter = '', stroke = 0, painting = false, lastHex = null, playReport = null, ruleset0 = null

async function openDocs(docs) { store = new EditorStore(docs); store.subscribe(() => { if (tab !== 'Map' || !painting) render() }); selected = null; edgeA = null; render() }
async function loadDemo() { const pkg = await readPackage(readJson, 'scenarios/demo'); ruleset0 = await readJson('data/ruleset.json'); await openDocs({ ...pkg, ruleset: ruleset0 }) }
async function boot() {
  ruleset0 = await readJson('data/ruleset.json'); $('tabs').innerHTML = TABS.map(t => `<button data-tab="${t}">${t}</button>`).join('')
  $('tabs').onclick = e => { const t = e.target.dataset.tab; if (t) { tab = t; render() } }
  $('undo').onclick = () => store.undo(); $('redo').onclick = () => store.redo()
  $('save').onclick = async () => { await savePackage('editor:' + store.docs.manifest.id, store.snapshot()); store.dirty = false; await refreshList(); render() }
  $('export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportBundle(store.snapshot())], { type: 'application/json' })); a.download = store.docs.manifest.id + '.elental.json'; a.click() }
  $('import').onchange = async e => { const f = e.target.files[0]; if (f) await openDocs(importBundle(await f.text())) }
  $('openbtn').onclick = async () => { const n = $('open').value; if (n) await openDocs(await loadPackage(n)) }
  $('newbtn').onclick = () => openDocs(newPackage(ruleset0)); $('demobtn').onclick = loadDemo
  $('launch').onclick = async () => { if (store.errors.length && !confirm(`${store.errors.length} validation errors — launch anyway?`)) return; const name = 'editor:' + store.docs.manifest.id; await savePackage(name, store.snapshot()); window.open(`index.html?scenario=idb:${encodeURIComponent(name)}`, '_blank') }
  await refreshList(); await loadDemo() }
async function refreshList() { const names = await listPackages(); $('open').innerHTML = names.map(n => `<option>${esc(n)}</option>`).join('') }
function render() {
  if (!store) return; $('title').textContent = `${store.docs.manifest.name}${store.dirty ? ' •' : ''}`; $('undo').disabled = !store.canUndo; $('redo').disabled = !store.canRedo
  $('badge').innerHTML = `<span class="${store.errors.length ? 'err' : ''}">${store.errors.length} errors</span> · <span class="warn">${store.warnings.length} warnings</span>`
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab)
  const fn = { Overview: overview, Map: mapTab, Tables: tablesTab, 'Nations & Countries': nationsTab, Generators: generatorsTab, Validation: validationTab, Playtest: playtestTab }[tab]; fn() }

// ---------------------------------------------------------------- Overview
function overview() { const d = store.docs, wl = worklist(d), provs = Object.keys(d.world.provinces).length
  $('view').innerHTML = `<div class="card"><h3>Scenario</h3><div class="row">Name <input id="mname" value="${esc(d.manifest.name)}"> id <input id="mid" value="${esc(d.manifest.id)}" style="width:100px"> seed <input id="mseed" type="number" value="${d.manifest.seed}" style="width:110px"></div>
  <div class="muted">${Object.keys(d.world.hexes).length} hexes · ${provs} land provinces · ${Object.keys(d.nations.nations).length} Nations · ${Object.keys(d.countries.countries).length} Countries · ${Object.keys(d.polity.cells).length} cells · ${Object.keys(d.ruleset.goods).length} goods · ${Object.keys(d.ruleset.pools).length} pools</div></div>
  <div class="card"><h3>Numbers-pass worklist</h3>${wl.length} fields are still <b>placeholder</b> (Tables tab → filter "placeholder"). Authoring a value in the Tuning table marks it <b>authored</b>.</div>
  <div class="card"><h3>Validation</h3>${store.errors.length} errors, ${store.warnings.length} warnings — see the Validation tab. Errors block a clean launch; warnings never do.</div>`
  const set = (id, path, conv = x => x) => { $(id).onchange = e => store.apply('manifest', [{ op: 'replace', path, value: conv(e.target.value) }]) }
  set('mname', '/manifest/name'); set('mid', '/manifest/id'); set('mseed', '/manifest/seed', Number) }

// ---------------------------------------------------------------- Map
const TOOLS = ['select', 'terrain', 'forestation', 'habitability', 'owner', 'surface', 'presence', 'edge', 'fortress']
function mapTab() {
  const d = store.docs
  $('view').innerHTML = `<div class="grid2"><div class="card"><div class="row"><b>Tool</b> ${TOOLS.map(t => `<label><input type="radio" name="tool" value="${t}" ${t === tool ? 'checked' : ''}>${t}</label>`).join(' ')}</div>
  <div class="row" id="toolopts"></div><div class="row">Lens <select id="lens"><option>terrain</option><option>owner</option><option>forestation</option><option>population</option><option>issues</option></select> <span class="muted" id="hint"></span></div>
  <div class="scroll"><canvas id="cv"></canvas></div></div><div class="card"><h3>Province</h3><div id="insp" class="muted">click a hex (Select tool)</div></div></div>`
  const opts = $('toolopts'), opt = (id, label, values, cur) => `<label>${label} <select id="${id}">${values.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`
  opts.innerHTML = tool === 'terrain' ? opt('t_terrain', 'terrain', Object.keys(d.ruleset.terrain), toolArg.terrain ?? 'Grassland')
    : tool === 'forestation' ? `<label>value <input id="t_forest" type="number" min="0" max="100" value="${toolArg.forest ?? 30}" style="width:70px"></label>`
    : tool === 'habitability' ? opt('t_hab', 'state', ['Wasteland', 'Claimed/Frontier', 'Settled'], toolArg.hab ?? 'Settled')
    : tool === 'owner' ? opt('t_owner', 'country', Object.keys(d.countries.countries), toolArg.owner ?? Object.keys(d.countries.countries)[0])
    : tool === 'surface' ? opt('t_surface', 'surface', ['land', 'sea', 'lake'], toolArg.surface ?? 'sea')
    : tool === 'presence' ? opt('t_nation', 'nation', Object.keys(d.nations.nations), toolArg.nation ?? Object.keys(d.nations.nations)[0]) + `<label>count <input id="t_count" type="number" value="${toolArg.count ?? 200}" style="width:80px"></label>`
    : tool === 'edge' ? opt('t_edge', 'edge', ['river', 'mountain_pass', 'sea_lane', 'remove'], toolArg.edge ?? 'river') + '<span class="muted">click province A, then adjacent province B</span>' : ''
  for (const el of opts.querySelectorAll('select,input')) el.onchange = () => { toolArg = { terrain: $('t_terrain')?.value, forest: +$('t_forest')?.value, hab: $('t_hab')?.value, owner: $('t_owner')?.value, surface: $('t_surface')?.value, nation: $('t_nation')?.value, count: +$('t_count')?.value, edge: $('t_edge')?.value } }
  toolArg = { terrain: $('t_terrain')?.value ?? toolArg.terrain, forest: +($('t_forest')?.value ?? toolArg.forest), hab: $('t_hab')?.value ?? toolArg.hab, owner: $('t_owner')?.value ?? toolArg.owner, surface: $('t_surface')?.value ?? toolArg.surface, nation: $('t_nation')?.value ?? toolArg.nation, count: +($('t_count')?.value ?? toolArg.count), edge: $('t_edge')?.value ?? toolArg.edge }
  for (const r of document.getElementsByName('tool')) r.onchange = () => { tool = r.value; edgeA = null; mapTab() }
  $('lens').value = window.__lens ?? 'terrain'; $('lens').onchange = () => { window.__lens = $('lens').value; drawMapCanvas() }
  const cv = $('cv'); cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); painting = true; stroke++; lastHex = null; useTool(e) }; cv.onpointermove = e => { if (painting) useTool(e) }; cv.onpointerup = () => { painting = false; render() }
  drawMapCanvas(); showInspector() }
function drawMapCanvas() { const d = store.docs, cv = $('cv'); if (!cv) return; const g = geometry(d.world.grid), ctx = cv.getContext('2d'), lens = window.__lens ?? 'terrain'; cv.width = g.W; cv.height = g.H
  const bad = new Set(store.issues.map(i => (i.path.match(/^\/world\/(?:provinces|hexes)\/[ph]:(\d+,\d+)/) ?? [])[1]).filter(Boolean))
  for (const h of Object.values(d.world.hexes)) { const [cx, cy] = g.ctr(h.x, h.y), id = `p:${h.x},${h.y}`, p = d.world.provinces[id]
    let col = SURFACE[h.surface]; if (h.surface === 'land' && p) col = lens === 'terrain' ? TERRAIN[p.terrain] : lens === 'owner' ? (d.countries.countries[p.owner]?.color ?? '#999') : lens === 'forestation' ? `hsl(120 50% ${90 - (p.forestation ?? 0) * 0.6}%)` : lens === 'population' ? `hsl(20 70% ${95 - Math.min(60, (p.population ?? 0) / 10)}%)` : (bad.has(`${h.x},${h.y}`) ? '#e57373' : TERRAIN[p.terrain])
    hexPath(ctx, cx, cy, g.s); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = selected === id || edgeA === id ? '#fff' : 'rgba(0,0,0,.25)'; ctx.lineWidth = selected === id || edgeA === id ? 3 : 1; ctx.stroke() }
  drawEdges(ctx, g, d.world.edges) }
function useTool(e) {
  const d = store.docs, h = pickHex($('cv'), e, d.world.grid, d.world.hexes); if (!h) return; const key = `${h.x},${h.y}`; if (key === lastHex && tool !== 'select') return; lastHex = key
  const id = `p:${h.x},${h.y}`, p = d.world.provinces[id], mk = `stroke${stroke}`, apply = (label, patches) => store.apply(label, patches, { mergeKey: mk, validate: false })
  if (tool === 'select') { if (p) { selected = id; showInspector() } }
  else if (tool === 'surface') apply('surface', C.setSurface(d, h.x, h.y, toolArg.surface))
  else if (!p) return
  else if (tool === 'terrain') apply('terrain', C.paintTerrain(d, [id], toolArg.terrain))
  else if (tool === 'forestation') apply('forestation', C.setProvinceField(d, id, 'forestation', toolArg.forest))
  else if (tool === 'habitability') apply('habitability', C.setProvinceField(d, id, 'habitability', toolArg.hab))
  else if (tool === 'owner') apply('owner', C.setOwner(d, [id], toolArg.owner))
  else if (tool === 'presence') apply('presence', C.setPresence(d, id, toolArg.nation, toolArg.count))
  else if (tool === 'edge' || tool === 'fortress') { if (!edgeA) edgeA = id; else if (edgeA !== id) { const adj = tool === 'fortress' || toolArg.edge === 'sea_lane' || C.adjacentProvinces(d, edgeA).includes(id)
      if (adj) store.apply('edge', tool === 'fortress' ? C.toggleEdgeFlag(d, edgeA, id, 'fortress') : C.setEdge(d, edgeA, id, toolArg.edge === 'remove' ? null : toolArg.edge)); edgeA = null } }
  if (!painting) store.revalidate(); drawMapCanvas() }
function showInspector() { const d = store.docs, el = $('insp'); if (!el) return; if (!selected || !d.world.provinces[selected]) { el.textContent = 'click a hex (Select tool)'; return }
  const p = d.world.provinces[selected], f = DOC_SCHEMAS.world.fields.provinces.item.fields
  el.innerHTML = `<b>${selected}</b><table>${Object.entries(f).filter(([k, v]) => ['int', 'float', 'string', 'enum', 'ref'].includes(v.type) && k !== 'x' && k !== 'y').map(([k, v]) => `<tr><td>${k}</td><td>${v.type === 'enum' ? `<select data-k="${k}">${v.values.map(x => `<option ${x === p[k] ? 'selected' : ''}>${x}</option>`).join('')}</select>` : v.type === 'ref' ? `<select data-k="${k}">${Object.keys(d.ruleset.terrain).map(x => `<option ${x === p[k] ? 'selected' : ''}>${x}</option>`).join('')}</select>` : `<input data-k="${k}" value="${esc(p[k] ?? '')}">`}</td></tr>`).join('')}
  <tr><td>owner</td><td><select data-k="owner"><option value="">—</option>${Object.keys(d.countries.countries).map(c => `<option ${c === p.owner ? 'selected' : ''}>${c}</option>`).join('')}</select></td></tr></table>`
  for (const inp of el.querySelectorAll('[data-k]')) inp.onchange = () => { const k = inp.dataset.k, t = f[k]?.type, v = t === 'int' || t === 'float' ? Number(inp.value) : inp.value === '' ? null : inp.value
    store.apply('province', k === 'terrain' ? C.paintTerrain(d, [selected], v) : C.setProvinceField(d, selected, k, v)) } }

// ---------------------------------------------------------------- Tables (schema-driven grids)
const TABLES = ['goods', 'pools', 'needs', 'terrain', 'tuning']
function flat(schema, prefix = []) { const out = []; for (const [k, f] of Object.entries(schema.fields ?? {})) { if (f.type === 'object') out.push(...flat(f, [...prefix, k])); else if (['int', 'float', 'bool', 'string', 'enum', 'ref'].includes(f.type)) out.push({ path: [...prefix, k], f }) } return out }
function tablesTab() {
  const d = store.docs, schemaItem = DOC_SCHEMAS.ruleset.fields[table].item, rows = Object.entries(d.ruleset[table] ?? {}).filter(([k]) => k.toLowerCase().includes(filter.toLowerCase()) || (filter === 'placeholder' && JSON.stringify(d.ruleset[table][k]).includes('placeholder')))
  const cols = table === 'tuning' ? [{ path: ['value'], f: { type: 'float' } }, { path: ['status'], f: { type: 'enum', values: ['placeholder', 'authored'] } }] : flat(schemaItem)
  const val = (o, path) => path.reduce((a, k) => a?.[k], o)
  $('view').innerHTML = `<div class="card"><div class="row">${TABLES.map(t => `<button data-t="${t}" ${t === table ? 'class="primary"' : ''}>${t}</button>`).join('')} <input id="flt" placeholder="filter (or: placeholder)" value="${esc(filter)}"> <span class="muted">dotted cells are placeholders awaiting the numbers pass</span></div>
  <div class="scroll"><table><tr><th>${table.slice(0, -1) || table}</th>${cols.map(c => `<th>${c.path.join('.')}</th>`).join('')}</tr>${rows.map(([k, row]) => `<tr><td>${esc(k)}</td>${cols.map(c => { const v = val(row, c.path), ph = c.f.status === 'placeholder' || (table === 'tuning' && row.status === 'placeholder' && c.path[0] === 'value')
    const cell = c.f.type === 'bool' ? `<input type="checkbox" ${v ? 'checked' : ''}>` : c.f.type === 'enum' ? `<select>${c.f.values.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>` : `<input value="${esc(Array.isArray(v) ? JSON.stringify(v) : (v ?? ''))}">`
    return `<td class="${ph ? 'ph' : ''}" data-k="${esc(k)}" data-p="${c.path.join('.')}" data-t="${c.f.type}">${cell}</td>` }).join('')}</tr>`).join('')}</table></div></div>`
  $('view').onclick = e => { const t = e.target.dataset?.t; if (e.target.tagName === 'BUTTON' && TABLES.includes(t)) { table = t; tablesTab() } }
  $('flt').oninput = e => { filter = e.target.value; tablesTab(); $('flt').focus(); $('flt').setSelectionRange(filter.length, filter.length) }
  for (const td of $('view').querySelectorAll('td[data-k]')) { const el = td.firstChild; el.onchange = () => { const k = td.dataset.k, path = td.dataset.p.split('.'), ty = td.dataset.t
    let v = ty === 'bool' ? el.checked : ty === 'int' || ty === 'float' ? Number(el.value) : el.value; if (table === 'tuning' && path[0] === 'value') { try { v = JSON.parse(el.value) } catch { v = el.value }; return store.apply('tuning', C.setTuning(d, k, v, 'authored')) }
    store.apply('table', [{ op: 'replace', path: ptr('ruleset', table, k, ...path), value: v }]) } } }

// ---------------------------------------------------------------- Nations & Countries
function nationsTab() { const d = store.docs
  const rows = (rec, base, extra) => Object.entries(rec).map(([id, x]) => `<tr><td>${esc(id)}</td><td><input data-b="${base}" data-id="${esc(id)}" data-f="name" value="${esc(x.name)}"></td><td><input type="color" data-b="${base}" data-id="${esc(id)}" data-f="color" value="${x.color ?? '#888888'}"></td>${extra(id, x)}</tr>`).join('')
  $('view').innerHTML = `<div class="grid2"><div class="card"><h3>Nations (peoples)</h3><table><tr><th>id</th><th>name</th><th>color</th><th>temperament</th></tr>${rows(d.nations.nations, 'nations/nations', (id, x) => `<td><input data-b="nations/nations" data-id="${esc(id)}" data-f="reactionTemperament" type="number" step="0.05" min="0" max="1" value="${x.reactionTemperament}" style="width:70px"></td>`)}</table>
   <div class="row"><input id="nid" placeholder="new nation id" style="width:120px"><button id="addn">Add Nation</button></div></div>
  <div class="card"><h3>Countries</h3><table><tr><th>id</th><th>name</th><th>color</th><th>player</th><th>titular</th></tr>${rows(d.countries.countries, 'countries/countries', (id, x) => `<td><input type="radio" name="pl" data-id="${esc(id)}" ${x.isPlayer ? 'checked' : ''}></td><td><select multiple data-titular="${esc(id)}" size="3">${Object.keys(d.nations.nations).map(n => `<option ${x.titularNations.includes(n) ? 'selected' : ''}>${n}</option>`).join('')}</select></td>`)}</table>
   <div class="row"><input id="cid" placeholder="new country id" style="width:120px"><button id="addc">Add Country</button></div></div></div>`
  for (const inp of $('view').querySelectorAll('input[data-f]')) inp.onchange = () => { const [a, b] = inp.dataset.b.split('/'); store.apply('edit', [{ op: 'replace', path: ptr(a, b, inp.dataset.id, inp.dataset.f), value: inp.type === 'number' ? Number(inp.value) : inp.value }]) }
  for (const r of document.getElementsByName('pl')) r.onchange = () => store.apply('player', Object.keys(d.countries.countries).map(c => ({ op: 'replace', path: ptr('countries', 'countries', c, 'isPlayer'), value: c === r.dataset.id })).concat([{ op: 'replace', path: '/scenario/playerCountry', value: r.dataset.id }]))
  for (const s of $('view').querySelectorAll('select[data-titular]')) s.onchange = () => store.apply('titular', [{ op: 'replace', path: ptr('countries', 'countries', s.dataset.titular, 'titularNations'), value: [...s.selectedOptions].map(o => o.value) }])
  $('addn').onclick = () => { const id = $('nid').value.trim(); if (id && !d.nations.nations[id]) store.apply('add nation', C.addNation(d, id, {})) }
  $('addc').onclick = () => { const id = $('cid').value.trim(); if (id && !d.countries.countries[id]) store.apply('add country', C.addCountry(d, id, {})) } }

// ---------------------------------------------------------------- Generators
const DESCR = { seedCells: 'Rebuild all cells (Region × Nation × Estate) from presence and the Estate templates; sum constraints hold by construction. Replaces the existing cells.', derivedWaterSource: 'Set waterSource from rivers, lakes and the sea (river first, then coastal).', normalisePresence: 'Scale each province’s Nation presence to its population.' }
function generatorsTab() { const d = store.docs
  $('view').innerHTML = `<div class="card"><h3>Generators</h3>${Object.keys(GENERATORS).map(g => { const n = GENERATORS[g](d).length; return `<div class="row"><button data-g="${g}">Apply ${g}</button><span class="muted">${esc(DESCR[g])} — would change <b>${n}</b> ${g === 'seedCells' ? 'document(s)' : 'field(s)'}</span></div>` }).join('')}
  <div class="row">noise <input id="gnoise" type="number" step="0.05" min="0" max="0.5" value="0" style="width:70px"> seed <input id="gseed" type="number" value="1" style="width:70px"> <span class="muted">(seedCells only)</span></div></div>
  <div class="card muted">Worldgen stages (terrain from noise, hydrology, countries…) are specified in worldgen__spec.md and plug in here as further generators. Hand-painted provinces carry provenance “manual”.</div>`
  for (const b of $('view').querySelectorAll('button[data-g]')) b.onclick = () => store.apply(b.dataset.g, GENERATORS[b.dataset.g](store.docs, { noise: +$('gnoise').value, seed: +$('gseed').value })) }

// ---------------------------------------------------------------- Validation
function validationTab() { const list = store.issues.slice().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  $('view').innerHTML = `<div class="card"><h3>${store.errors.length} errors · ${store.warnings.length} warnings</h3><ul style="list-style:none;padding:0;max-height:70vh;overflow:auto">${list.map((i, n) => `<li class="issue ${i.severity === 'error' ? 'err' : 'warn'}" data-n="${n}">${i.severity.toUpperCase()} <b>${esc(i.id)}</b> ${esc(i.message)} <span class="muted">${esc(i.path)}</span></li>`).join('') || '<li>no issues</li>'}</ul></div>`
  for (const li of $('view').querySelectorAll('li[data-n]')) li.onclick = () => { const i = list[+li.dataset.n], m = i.path.match(/^\/world\/(?:provinces|hexes)\/[ph]:(\d+),(\d+)/), t = i.path.match(/^\/ruleset\/(\w+)/)
    if (m) { selected = `p:${m[1]},${m[2]}`; tab = 'Map'; tool = 'select'; render() } else if (t && TABLES.includes(t[1])) { table = t[1]; filter = ''; tab = 'Tables'; render() } else alert(i.path) } }

// ---------------------------------------------------------------- Playtest (headless, real engine; never touches the package)
async function playtestTab() {
  $('view').innerHTML = `<div class="card"><h3>Headless playtest</h3><div class="row">Turns <input id="pn" type="number" value="20" min="1" max="200" style="width:70px"> <button id="prun" class="primary">Run</button> <span id="pst" class="muted"></span></div><div id="pout">${playReport ?? ''}</div></div>`
  $('prun').onclick = async () => { $('pst').textContent = 'running…'; await new Promise(r => setTimeout(r, 20))
    try { const { ruleset, ...pkg } = store.snapshot(), c = new EngineClient(); await c.init(pkg, ruleset); const n = +$('pn').value; await c.runTurns(n); const h = await c.query('history'), cs = await c.query('cells')
      const bad = []; for (const x of cs) { if (x.wealth < 0) bad.push(`negative wealth ${x.key}`); for (const v of Object.values(x.grievance)) if (v < 0 || v > 1) bad.push(`grievance out of range ${x.key}`) }
      const rows = h.filter((_, i) => i % Math.max(1, Math.floor(n / 10)) === 0 || i === h.length - 1)
      playReport = `<table><tr><th>turn</th>${Object.keys(h[0].countries).map(k => `<th>${k}: pop</th><th>ledger</th><th>subsistence</th><th>grievance</th><th>Q</th>`).join('')}</tr>${rows.map(s => `<tr><td>${s.turn}</td>${Object.values(s.countries).map(v => `<td>${Math.round(v.population)}</td><td>${Math.round(v.ledger)}</td><td>${v.subsistence.toFixed(2)}</td><td>${v.grievance.toFixed(2)}</td><td>${v.questions}</td>`).join('')}</tr>`).join('')}</table><p class="${bad.length ? 'err' : ''}">${bad.length ? 'invariant failures: ' + esc(bad.slice(0, 5).join('; ')) : 'invariants hold (wealth ≥ 0, grievance and satisfaction within [0,1])'}</p>`
    } catch (e) { playReport = `<p class="err">${esc(e.message)}</p>` } playtestTab() } }
boot().catch(e => { document.getElementById('view').textContent = 'error: ' + e.message; console.error(e) })
