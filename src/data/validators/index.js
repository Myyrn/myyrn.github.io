// data/validators/index.js — structural (schema) + referential + invariants. Issue = {id, severity, path, message}. Errors block launch/export; warnings never do.
import { validate as validateField, placeholders } from '../../kernel/schema.js'
import { DOC_SCHEMAS, CORE_POOLS } from '../schemas/index.js'
import { neighbors, parseId } from '../../modules/worldmap/hex.js'
import { deriveRegions } from '../../modules/worldmap/regions.js'
const sum = a => a.reduce((s, x) => s + x, 0)

export function refsOf(docs) {
  const keys = o => new Set(Object.keys(o ?? {}))
  return { terrain: keys(docs.ruleset?.terrain), goods: keys(docs.ruleset?.goods), pools: keys(docs.ruleset?.pools), needs: keys(docs.ruleset?.needs), provinces: keys(docs.world?.provinces),
    nations: keys(docs.nations?.nations), countries: keys(docs.countries?.countries), estates: keys(docs.polity?.estates), lawTemplates: keys(docs.polity?.lawTemplates) } }
export function structural(docs, refs = refsOf(docs)) {
  const issues = []
  for (const [name, schema] of Object.entries(DOC_SCHEMAS)) { if (!docs[name]) { issues.push({ id: 'missingDoc', severity: 'error', path: `/${name}`, message: `document "${name}" is missing` }); continue }
    for (const i of validateField(schema, docs[name], `/${name}`, refs)) issues.push(i) }
  return issues }
export function regionsOf(docs) { const w = docs.world, owners = Object.fromEntries(Object.entries(w.provinces).map(([id, p]) => [id, p.owner ?? null])); return deriveRegions({ w: w.grid.w, h: w.grid.h }, owners) }
export function invariants(docs, refs = refsOf(docs)) {
  const out = [], bad = (id, path, message, severity = 'error') => out.push({ id, severity, path, message }), w = docs.world, R = docs.ruleset, P = w.provinces
  // ---- world
  for (const [hid, h] of Object.entries(w.hexes)) { const isProv = !!P[`p:${h.x},${h.y}`]; if (h.surface === 'land' && !isProv) bad('landNoProvince', `/world/hexes/${hid}`, `land hex ${hid} has no province`); if (h.surface !== 'land' && isProv) bad('waterProvince', `/world/hexes/${hid}`, `${h.surface} hex ${hid} must not carry a province`) }
  for (const [pid, p] of Object.entries(P)) {
    if (!w.hexes[`h:${p.x},${p.y}`]) bad('noHex', `/world/provinces/${pid}`, 'province without a hex')
    const t = R.terrain?.[p.terrain]; if (t && p.forestation !== undefined && (p.forestation < t.forestMin || p.forestation > t.forestMax)) bad('forestCeiling', `/world/provinces/${pid}/forestation`, `forestation ${p.forestation} outside ${p.terrain} range ${t.forestMin}-${t.forestMax}`, 'warn')
    if (p.habitability === 'Wasteland' && p.population > 0) bad('wastelandPop', `/world/provinces/${pid}/population`, 'Wasteland must have zero population', 'warn')
    if (p.owner && !refs.countries.has(p.owner)) bad('ref', `/world/provinces/${pid}/owner`, `unknown country ${p.owner}`)
    if (p.maxPopulationDensity !== undefined && p.maxArea !== undefined && p.population > p.maxPopulationDensity * p.maxArea * 1.0001) bad('popOverDensity', `/world/provinces/${pid}/population`, 'population exceeds density × area', 'warn') }
  for (const [i, e] of w.edges.entries()) { const A = P[e.a], B = P[e.b], path = `/world/edges/${i}`
    if (!A || !B) { bad('edgeEnds', path, 'edge endpoint is not a province'); continue }
    const adj = neighbors(A.x, A.y, w.grid.w, w.grid.h).some(n => n.x === B.x && n.y === B.y)
    if (e.type !== 'sea_lane' && !adj) bad('edgeAdjacency', path, `${e.type} edge must join adjacent hexes`)
    if (e.type === 'mountain_pass' && !(A.terrain === 'Mountain' || B.terrain === 'Mountain')) bad('passTerrain', path, 'mountain pass must touch a Mountain hex', 'warn')
    if (e.type === 'sea_lane') for (const [pid, p] of [[e.a, A], [e.b, B]]) if (p.waterSource !== 'coastal' && !neighbors(p.x, p.y, w.grid.w, w.grid.h).some(n => w.hexes[`h:${n.x},${n.y}`]?.surface === 'sea')) bad('seaLaneCoast', path, `sea lane endpoint ${pid} is not coastal`, 'warn') }
  // ---- nations / presence
  for (const [pid, pr] of Object.entries(docs.nations.presence ?? {})) { if (!P[pid]) { bad('presenceProv', `/nations/presence/${pid}`, 'presence for an unknown province'); continue }
    for (const n of Object.keys(pr)) if (!refs.nations.has(n)) bad('ref', `/nations/presence/${pid}/${n}`, `unknown nation ${n}`)
    if (sum(Object.values(pr)) > (P[pid].population ?? 0) * 1.01 + 1) bad('presenceSum', `/nations/presence/${pid}`, 'Nation presence exceeds province population') }
  // ---- countries
  const owned = {}; for (const p of Object.values(P)) if (p.owner) owned[p.owner] = (owned[p.owner] ?? 0) + 1
  for (const c of refs.countries) if (!owned[c]) bad('countryEmpty', `/countries/countries/${c}`, `country ${c} owns no province`, 'warn')
  if (Object.values(docs.countries.countries).filter(c => c.isPlayer).length !== 1) bad('playerCount', '/countries', 'exactly one player Country expected', 'warn')
  for (const [c, def] of Object.entries(docs.polity.countryLaws ?? {})) if (!refs.countries.has(c)) bad('ref', `/polity/countryLaws/${c}`, `unknown country ${c}`)
  for (const c of refs.countries) if (!docs.polity.countryLaws?.[c]) bad('lawMissing', `/polity/countryLaws/${c}`, `country ${c} has no law template`)
  // ---- polity cells vs regions and sums
  const regs = regionsOf(docs), regionIds = new Set(Object.keys(regs.regions)), byNationRegion = {}
  for (const [key, c] of Object.entries(docs.polity.cells)) { const [n, e, r] = key.split('|')
    if (!refs.nations.has(n)) bad('ref', `/polity/cells/${key}`, `unknown nation ${n}`); if (!refs.estates.has(e)) bad('ref', `/polity/cells/${key}`, `unknown estate ${e}`); if (!regionIds.has(r)) bad('cellRegion', `/polity/cells/${key}`, `region ${r} does not exist in the derived Regions`)
    byNationRegion[`${n}|${r}`] = (byNationRegion[`${n}|${r}`] ?? 0) + c.population }
  for (const [r, reg] of Object.entries(regs.regions)) for (const n of refs.nations) { const expect = sum(reg.provinces.map(p => docs.nations.presence?.[p]?.[n] ?? 0)), got = byNationRegion[`${n}|${r}`] ?? 0
    if (expect > 0 || got > 0) { const rel = Math.abs(expect - got) / Math.max(1, expect); if (rel > 0.05) bad('cellSum', `/polity/cells`, `Region ${r}, Nation ${n}: cells sum ${got} vs presence ${expect}`); else if (rel > 0.01) bad('cellSum', `/polity/cells`, `Region ${r}, Nation ${n}: cells sum ${got} vs presence ${expect}`, 'warn') } }
  const share = sum(Object.values(docs.polity.estates).map(e => e.populationShare)); if (Math.abs(share - 1) > 0.01) bad('estateShares', '/polity/estates', `Estate population shares sum to ${share.toFixed(3)}, expected 1`, 'warn')
  // ---- ruleset
  const goods = Object.entries(R.goods ?? {}), nume = goods.filter(([, g]) => g.numeraire)
  if (nume.length !== 1) bad('numeraire', '/ruleset/goods', 'exactly one numeraire good expected'); else if (nume[0][1].baseValue !== 1) bad('numeraireValue', `/ruleset/goods/${nume[0][0]}/baseValue`, 'numeraire base value must be 1')
  for (const [g, d] of goods) if (!(d.baseValue > 0)) bad('baseValue', `/ruleset/goods/${g}/baseValue`, 'base value must be > 0')
  for (const g of goods.filter(([, d]) => d.tier === 'raw' && !d.extractPool).map(([g]) => g)) bad('extractPool', `/ruleset/goods/${g}/extractPool`, 'raw good without an extraction pool')
  for (const p of CORE_POOLS) if (!R.pools?.[p]) bad('corePool', `/ruleset/pools/${p}`, `core pool ${p} is missing`, 'warn')
  for (const c of Object.keys(R.consumption ?? {})) for (const [i, it] of R.consumption[c].entries()) for (const g of it.any) if (!refs.goods.has(g)) bad('ref', `/ruleset/consumption/${c}/${i}`, `unknown good ${g}`)
  return out }
export function tuningKeysMissing(ruleset, required) { return required.filter(k => !ruleset.tuning?.[k]).map(k => ({ id: 'tuningKey', severity: 'error', path: `/ruleset/tuning/${k}`, message: `missing tuning key ${k}` })) }
export function validateAll(docs) { const refs = refsOf(docs), issues = structural(docs, refs); if (!issues.some(i => i.id === 'missingDoc')) issues.push(...invariants(docs, refs)); return issues }
export const hasErrors = issues => issues.some(i => i.severity === 'error')
export function worklist(docs) { const out = placeholders(DOC_SCHEMAS.ruleset, docs.ruleset, '/ruleset'); for (const [k, t] of Object.entries(docs.ruleset.tuning ?? {})) if (t.status === 'placeholder') out.push(`/ruleset/tuning/${k}`); return out }
