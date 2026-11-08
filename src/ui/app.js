// ui/app.js — the game shell: TopBar, ScopePicker, workspace tabs, DockedDetailPanel, Orders tray, Commitments ledger, Event Draft sheet, turn report.
// Reads ONLY through EngineClient queries; holds UI-local state only (UI Rule 4). Plain ES modules, no bundler.
import { readPackage } from '../data/loaders/readPackage.js'
import { EngineClient } from '../client/engineClient.js'
import { loadPackage } from '../editor/bundle.js'
import { h, card, fmt, short, badge, tabs, kv, rawView, table } from './dom.js'
import { scopeOf, scopeLabel, SLICE_ORDERS } from './scope.js'
import { FORMS, FORM_GROUPS, formsIn, buildOrder, defaults, describeOrder } from './forms.js'
import * as mapView from './views/map.js'
import * as polityView from './views/polity.js'
import * as apparatusView from './views/apparatus.js'
import * as economyView from './views/economy.js'
import * as worldView from './views/world.js'
import { dockContent } from './views/dock.js'

const params = new URLSearchParams(location.search), scn = params.get('scenario') ?? 'demo'
const readJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() }
export const WORKSPACES = { Map: mapView, Polity: polityView, Apparatus: apparatusView, Economy: economyView, World: worldView }
export const app = { client: new EngineClient(), ui: { workspace: 'Map', tab: {}, filter: {}, sliceOrder: 0, lens: 'owner', lensParam: null, mapMode: 'Map', selected: null, debug: false, country: null, report: null, trayOpen: false, ledgerOpen: false }, rules: null }
app.q = (name, args = {}) => app.client.query(name, args)
app.me = () => app.ui.country
app.scope = () => scopeOf(app.ui.filter)
const $ = id => document.getElementById(id)

export async function boot(root = document) {
  let pkg, ruleset
  if (scn.startsWith('idb:')) { const docs = await loadPackage(scn.slice(4)); if (!docs) throw new Error(`no saved package ${scn}`); ({ ruleset, ...pkg } = docs) }
  else { pkg = await readPackage(readJson, `scenarios/${scn}`); ruleset = await readJson('data/ruleset.json') }
  await app.client.init(pkg, ruleset); app.ui.country = pkg.scenario.playerCountry; app.pkg = pkg; app.rules = await app.q('rules')
  window.elental = app                                  // handle for tests and the console (read-only use)
  $('scn').textContent = pkg.manifest.name; buildTop(); await renderAll(); return app }

function buildTop() {
  const cs = Object.entries(app.pkg.countries.countries)
  $('country').replaceChildren(...cs.map(([id, c]) => h('option', { value: id, selected: id === app.ui.country }, c.name)))
  $('country').onchange = async () => { app.ui.country = $('country').value; app.ui.filter = {}; app.ui.selected = null; await renderAll() }
  $('end').onclick = () => run(1); $('run5').onclick = () => run(5)
  $('debug').onchange = async e => { app.ui.debug = e.target.checked; await renderAll() }
  $('workspaces').replaceChildren(...Object.keys(WORKSPACES).map(n => h('button', { class: 'ws', id: `ws-${n}`, onclick: async () => { app.ui.workspace = n; await renderAll() } }, n)))
  $('top-actions').append(draftMenu())
  $('traytoggle').onclick = async () => { app.ui.trayOpen = !app.ui.trayOpen; await renderTray() }
  $('ledgertoggle').onclick = async () => { app.ui.ledgerOpen = !app.ui.ledgerOpen; await renderTray() } }

export async function run(n) {
  $('status').textContent = 'resolving…'; let rep
  for (let i = 0; i < n; i++) rep = (await app.client.endTurn()).report
  app.ui.report = rep; $('status').textContent = ''; await renderAll(); showReport(rep) }

function showReport(rep) {
  const bad = rep.rejected.length + rep.refused.length; const m = $('modal'); m.replaceChildren()
  if (!rep.executed.length && !bad && !rep.entitlementLosses?.length) { return }
  m.append(h('div', { class: 'sheet report', id: 'report' }, h('h3', null, 'Turn report'), h('p', null, `${rep.executed.length} executed`, bad ? ` · ${rep.rejected.length} rejected · ${rep.refused.length} refused by a Veto` : ''),
    rep.rejected.length ? h('ul', null, rep.rejected.map(r => h('li', null, badge('rejected', 'bad'), ` ${r.type}: ${(r.reasons ?? []).join(', ')}`))) : null,
    rep.refused.length ? h('ul', null, rep.refused.map(r => h('li', null, badge('refused', 'warn'), ` ${r.type ?? r.a?.type ?? 'action'} — holders: ${(r.holders ?? r.g?.holders ?? []).join(', ') || 'Veto'}`))) : null,
    rep.entitlementLosses?.length ? h('p', { class: 'muted' }, `${rep.entitlementLosses.length} entitlement loss(es) recorded`) : null,
    h('button', { class: 'primary', onclick: () => m.replaceChildren() }, 'Close'))) }

export async function renderAll() {
  const u = app.ui, ests = await app.q('estates', { country: u.country }), turn = app.client.snapshotMeta().turn
  $('turn').textContent = turn
  for (const n of Object.keys(WORKSPACES)) $(`ws-${n}`)?.classList.toggle('on', n === u.workspace)
  renderScopePicker(ests)
  const main = $('main'); main.replaceChildren(h('div', { class: 'muted pad' }, 'loading…'))
  try { main.replaceChildren(await WORKSPACES[u.workspace].render(app, { ests })) } catch (e) { main.replaceChildren(h('pre', { class: 'err' }, `view error: ${e.stack ?? e}`)); console.error(e) }
  await renderDock(); await renderTray() }

function renderScopePicker(ests) {
  const f = app.ui.filter, uniq = k => [...new Set(ests.flatMap(e => String(e[k]).split('+')))].sort()
  const sel = (k, label) => h('label', { class: 'pick' }, label, h('select', { id: `scope-${k}`, onchange: async e => { if (e.target.value) f[k] = e.target.value; else delete f[k]; await renderAll() } }, h('option', { value: '' }, 'all'), uniq(k).map(v => h('option', { value: v, selected: f[k] === v }, v))))
  const sc = scopeOf(f)
  $('scope').replaceChildren(h('span', { class: 'muted' }, 'Scope'), sel('nation', 'Nation'), sel('estate', 'Estate'), sel('region', 'Region'), h('button', { id: 'scope-reset', onclick: async () => { app.ui.filter = {}; await renderAll() } }, 'Empire'),
    h('span', { class: `chip ${sc.error ? 'bad' : ''}`, id: 'scope-label', title: sc.error ?? 'Scope used by drafts' }, sc.error ? '⚠ ' + scopeLabel(f) : scopeLabel(sc.scope)),
    h('select', { id: 'slice', title: 'SliceOrder (scope tree)', onchange: async e => { app.ui.sliceOrder = +e.target.value; await renderAll() } }, SLICE_ORDERS.map((o, i) => h('option', { value: i, selected: i === app.ui.sliceOrder }, o.map(x => x[0].toUpperCase()).join('›'))))) }

export function select(kind, id) { app.ui.selected = { kind, id }; return renderDock() }
async function renderDock() {
  const d = $('dock'), s = app.ui.selected; d.replaceChildren(await dockContent(app, s)) }

// ---- Orders tray + Commitments ledger
async function renderTray() {
  const orders = await app.q('orders'), t = $('tray'), n = orders.length
  $('traytoggle').textContent = `Orders (${n})`; $('ledgertoggle').textContent = 'Commitments'
  const body = h('div', { class: 'trayBody' })
  if (app.ui.trayOpen) {
    if (!orders.length) body.append(h('p', { class: 'muted' }, 'No orders queued. Orders resolve together when you end the turn; open a draft from any workspace or the Draft menu.'))
    for (const o of orders) { const pv = await app.q('preview', { order: o })
      body.append(h('div', { class: 'order', 'data-order': o.id }, h('b', null, o.actor.country ?? o.actor.key), ' ', describeOrder(o), ' ',
        pv.valid ? (pv.blocked ? badge(`Veto: ${pv.holders.join(', ')}`, 'warn') : badge(pv.gateDomain ? `gate ${pv.gateDomain}: clear` : pv.class, 'ok')) : badge(`invalid: ${(pv.reasons ?? []).join(', ')}`, 'bad'), ' ',
        h('button', { class: 'x', onclick: async () => { await app.client.removeOrder(o.id); await renderTray() } }, '✕'))) }
    if (orders.length) body.append(h('button', { onclick: async () => { await app.client.clearOrders(); await renderTray() } }, 'Clear all')) }
  const led = h('div', { class: 'trayBody' })
  if (app.ui.ledgerOpen) { const cs = await app.q('commitments', { country: app.me() }); led.append(cs.length ? cs.map(c => h('div', { class: 'order' }, badge(c.kind), ' ', c.text, c.kind === 'propaganda' ? h('button', { onclick: () => openDraft('liftPropaganda') }, 'release') : null)) : h('p', { class: 'muted' }, 'No standing commitments.')) }
  t.querySelector('#trayBody')?.replaceChildren(body, led) }

// ---- Event Draft sheet: choose fields -> Preview (validate + gating verdict) -> Queue
async function draftOptions() {
  const me = app.me(), [est, gov, mil, tre, rules, world, laws] = await Promise.all([app.q('estates', { country: me }), app.q('govCard', { country: me }), app.q('military', { country: me }), app.q('treaties', { country: me }), app.q('rules'), app.q('world', { country: me }), app.q('laws', { country: me })])
  const sc = app.scope(), sel = app.ui.selected?.kind === 'province' ? app.ui.selected.id : null, map = await app.q('provinceCard', { id: sel ?? Object.keys(app.pkg ? {} : {})[0] ?? 'p:0,0' }).catch(() => null)
  return { me, scope: sc.scope, scopeError: sc.error, filter: app.ui.filter, gov, rights: rules.rights, duties: rules.duties, goods: rules.goods, armyPools: rules.armyPools, axes: rules.axes, axisNames: rules.axisNames,
    estates: [...new Set(est.flatMap(e => e.estate.split('+')))].sort(), myCells: est.map(e => e.key), armies: mil.mine.map(a => a.id), wars: mil.wars.filter(w => w.active && !w.ended).map(w => ({ v: w.id, l: `${w.a} vs ${w.b}${w.internal ? ' (internal)' : ''}` })),
    countries: world.others.map(o => ({ v: o.id, l: o.name })), counterparts: world.others.map(o => ({ v: o.id, l: o.name })), granteeIds: [...world.others.map(o => ({ v: o.id, l: o.name })), ...mil.blocs.filter(b => b.status === 'active').map(b => ({ v: b.id, l: `bloc ${b.id}` }))],
    treaties: tre.active.map(t => ({ v: t.id, l: `${t.kind}${t.tier ? ' ' + t.tier : ''} ${t.id}` })), proposals: tre.proposals.filter(p => p.incoming).map(p => ({ v: p.id, l: `${p.kind} ${p.tier ?? ''} from ${p.from}` })), blocs: mil.blocs.filter(b => b.status === 'active' && b.country !== me).map(b => ({ v: b.id, l: `${b.id} (vs ${b.country})` })),
    propaganda: gov.propaganda.map(p => ({ v: p.id, l: `${p.id} (${p.amount})` })), selectedProvince: sel, provinceOwner: map?.owner } }

export async function openDraft(type, preset = {}) {
  const f = FORMS[type], o = await draftOptions(), sheet = $('draft'), vals = { ...defaults(type, o), ...preset }, result = h('div', { class: 'verdict', id: 'verdict' })
  const field = fd => { const on = (k, v) => { vals[k] = v }
    const input = fd.type === 'select' ? h('select', { name: fd.name, onchange: e => on(fd.name, e.target.value) }, fd.options.map(x => h('option', { value: x.v, selected: String(x.v) === String(vals[fd.name]) }, x.l)))
      : fd.type === 'check' ? h('input', { type: 'checkbox', name: fd.name, checked: !!vals[fd.name], onchange: e => on(fd.name, e.target.checked) })
      : fd.type === 'multi' ? h('span', { class: 'multi' }, fd.options.map(x => h('label', null, h('input', { type: 'checkbox', value: x.v, checked: (vals[fd.name] ?? []).includes(x.v), onchange: e => { const s = new Set(vals[fd.name] ?? []); e.target.checked ? s.add(x.v) : s.delete(x.v); on(fd.name, [...s]) } }), x.l)))
      : fd.type === 'json' ? h('textarea', { name: fd.name, rows: 2, onchange: e => on(fd.name, e.target.value) }, vals[fd.name] ?? '')
      : h('input', { type: fd.type === 'number' ? 'number' : 'text', name: fd.name, value: vals[fd.name] ?? '', min: fd.min, max: fd.max, step: fd.step, onchange: e => on(fd.name, e.target.value) })
    return h('label', { class: 'fld' }, h('span', null, fd.label), input) }
  const build = () => buildOrder(type, vals, o)
  const preview = async () => { const b = build(); result.replaceChildren(); if (b.error) { result.append(badge(b.error, 'bad')); return null }
    const pv = await app.q('preview', { order: b.order }); if (!pv.valid) result.append(badge(`invalid: ${(pv.reasons ?? []).join(', ')}`, 'bad'))
    else { result.append(badge(pv.class), ' ', pv.gateDomain ? badge(pv.blocked ? `refused by ${pv.holders.join(', ')}` : `${pv.gateDomain} Veto: clear`, pv.blocked ? 'warn' : 'ok') : badge('ungated', 'ok'), ' ', badge(pv.visibility), pv.verdicts.length ? h('div', { class: 'muted' }, 'holders: ' + pv.verdicts.map(v => `${v.cell} (${v.stance})`).join(', ')) : null,
      pv.blocked ? h('div', { class: 'muted' }, 'It would fail at the table; forcing it through Control means entitlement loss for the holders.') : null) } return b.order }
  const queue = async () => { const order = await preview(); if (!order) return; const pv = await app.q('preview', { order }); if (!pv.valid) return; await app.client.submit(order); sheet.replaceChildren(); app.ui.trayOpen = true; await renderTray() }
  sheet.replaceChildren(h('div', { class: 'sheet', id: 'draftSheet' }, h('h3', null, f.title, ' ', f.scoped ? h('span', { class: 'chip' }, 'scope: ' + (o.scopeError ? '⚠' : scopeLabel(o.scope))) : null), f.help ? h('p', { class: 'muted' }, f.help) : null,
    h('div', { class: 'fields' }, f.fields(o).map(field)), result, h('div', { class: 'row' }, h('button', { id: 'draft-preview', onclick: preview }, 'Preview'), h('button', { id: 'draft-queue', class: 'primary', onclick: queue }, 'Queue order'), h('button', { onclick: () => sheet.replaceChildren() }, 'Cancel')))) }

export function draftMenu() { return h('span', { class: 'menu' }, h('select', { id: 'draftmenu', onchange: e => { if (e.target.value) openDraft(e.target.value); e.target.value = '' } }, h('option', { value: '' }, 'Draft…'), FORM_GROUPS.map(g => h('optgroup', { label: g }, formsIn(g).map(f => h('option', { value: f.id }, f.title)))))) }
