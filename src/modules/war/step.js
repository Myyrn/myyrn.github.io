// war/step.js — step 4: movement, supply, clashes, sieges/occupation, recovery.
import { stepAllowed, findPath, bfsDistance } from './graph.js'
import { fight } from './combat.js'
import { controller, isBloc, stepInternal } from './internal.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x))
const W = ctx => ctx.state.war, P = ctx => ctx.state.world.provinces
export const atWar = (ctx, a, b) => W(ctx).wars.some(w => w.active && ((w.a === a && w.b === b) || (w.a === b && w.b === a)))
export const armyStrength = (ctx, army) => sum(army.units.map(id => W(ctx).units[id].n))
const speedOf = (ctx, army) => Math.min(...army.units.map(id => ctx.ruleset.pools[W(ctx).units[id].pool].combat.speed))
const enemyArmies = (ctx, army, p) => Object.values(W(ctx).armies).filter(o => o.owner !== army.owner && o.position === p && atWar(ctx, army.owner, o.owner) && armyStrength(ctx, o) > 0)

function moveArmies(ctx) {
  for (const army of Object.values(W(ctx).armies).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    army.arrived = false; if (!army.path?.length) continue
    const infra = P(ctx)[army.position].infrastructureLevel ?? 30
    let steps = Math.max(1, Math.floor(speedOf(ctx, army) * (0.5 + infra / 100)))                    // speed = slowest of the formation; edge quality gates progress
    while (steps > 0 && army.path.length) { const next = army.path[0], s = stepAllowed(ctx, army.position, next, army); if (!s) { army.path = findPath(ctx, army.position, army.destination, army) ?? []; break }
      steps -= s.cost; army.prev = army.position; army.position = next; army.path.shift(); army.arrived = true
      if (enemyArmies(ctx, army, army.position).length || (controller(ctx, army.position) !== army.owner && atWar(ctx, army.owner, controller(ctx, army.position)))) break } }   // stop to fight / besiege
}
function supply(ctx) {
  for (const army of Object.values(W(ctx).armies)) {
    const friendly = p => (P(ctx)[p].owner === army.owner && controller(ctx, p) === army.owner) || W(ctx).occupations[p]?.occupier === army.owner
    const src = bfsDistance(ctx, army.position, friendly, p => friendly(p) || p === army.position), d = src?.distance ?? 99
    const infra = P(ctx)[army.position].infrastructureLevel ?? 30, base = d >= 99 ? 0 : clamp01(1 - ctx.T('war.supply.decay') * d * (1 - ctx.T('war.supply.infraRelief') * infra / 100))
    // real draw against the nearest warehouse (zero-sum with civilians): upkeep goods per man
    let need = {}; for (const id of army.units) { const u = W(ctx).units[id]; for (const [g, q] of Object.entries(ctx.ruleset.pools[u.pool].combat.upkeep)) need[g] = (need[g] ?? 0) + q * u.n }
    army.src = src?.province ?? army.position                                                          // read back by Economics as military demand next turn
    let got = 1                                                                                          // real zero-sum draw from the supply zone's market (competes with civilians)
    for (const [g, q] of Object.entries(need)) { const take = ctx.services.economics.draw(army.src, g, q); got = Math.min(got, q > 0 ? take / q : 1) }
    for (const id of army.units) { const u = W(ctx).units[id]; u.supply = clamp01(base * got); if (u.supply < 0.5) u.cohesion = clamp01(u.cohesion - 0.02) } } }
function clashes(ctx) {
  const done = new Set()
  for (const a of Object.values(W(ctx).armies).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (done.has(a.id) || armyStrength(ctx, a) <= 0) continue
    const foes = enemyArmies(ctx, a, a.position); if (!foes.length) continue
    const D = foes[0], attacker = a.arrived || !D.arrived ? a : D, defender = attacker === a ? D : a; done.add(a.id); done.add(D.id)
    const r = fight(ctx, attacker, defender, a.position)
    for (const l of r.log) logScore(ctx, { cause: 'battle', side: r.winner === 'A' ? attacker.owner : defender.owner, cells: [l.cell], harm: { killed: l.killed, wounded: l.wounded } })
    const loser = r.winner === 'A' ? defender : attacker
    if (armyStrength(ctx, loser) < 1) { for (const id of loser.units) delete W(ctx).units[id]; delete W(ctx).armies[loser.id] }
    else if (loser.prev) { loser.position = loser.prev; loser.path = []; loser.destination = null } } }
function sieges(ctx) {
  for (const army of Object.values(W(ctx).armies)) {
    const p = army.position, prov = P(ctx)[p], ctl = prov && controller(ctx, p); if (!prov || ctl === army.owner || !atWar(ctx, army.owner, ctl) || enemyArmies(ctx, army, p).length || W(ctx).occupations[p]?.occupier === army.owner) continue
    const garrison = ctx.T('war.garrison.perPop') * prov.population, fort = 1 + Object.keys(ctx.state.world.edges).filter(k => k.includes(p) && ctx.state.world.edges[k].fortress).length
    const siegeStr = sum(army.units.map(id => { const u = W(ctx).units[id], s = ctx.ruleset.pools[u.pool].combat; return u.n * (s.siege ?? 0.2) * u.supply }))
    const s = (W(ctx).sieges[p] ??= { besieger: army.owner, progress: 0, since: ctx.state.meta.turn })
    const def = ctx.T('war.siege.defRate') * garrison * fort * 10, ratio = Math.max(-0.5, Math.min(1, (ctx.T('war.siege.rate') * siegeStr - def) / (ctx.T('war.siege.rate') * siegeStr + def + 1e-9)))
    s.progress += ctx.T('war.siege.capture') / ctx.T('war.siege.turns') * ratio                                      // ~`turns` turns when the besieger clearly dominates
    s.progress = Math.max(0, s.progress)
    for (const k of cellsIn(ctx, p)) logScore(ctx, { cause: 'siege', side: army.owner, cells: [k], harm: { turns: 1 } })
    if (s.progress >= ctx.T('war.siege.capture')) { if (isBloc(ctx, ctl) && army.owner === prov.owner) delete W(ctx).occupations[p]; else W(ctx).occupations[p] = { occupier: army.owner, since: ctx.state.meta.turn }; delete W(ctx).sieges[p] } } }   // the owner retaking a bloc-held province liberates it
export const cellsIn = (ctx, p) => { const region = ctx.state.world.regionSnapshot.assignment[p]; return Object.keys(ctx.state.polity.cells).filter(k => k.endsWith(`|${region}`) && ctx.derive.worldmap.presence(p, k.split('|')[0]) > 0) }
export function logScore(ctx, e) { W(ctx).score.push({ ...e, turn: ctx.state.meta.turn }) }   // per-cell harm in existing stocks; never spendable
function recover(ctx) {
  for (const u of Object.values(W(ctx).units)) { const back = (u.wounded ?? []).filter(w => w.returnTurn <= ctx.state.meta.turn); u.wounded = (u.wounded ?? []).filter(w => w.returnTurn > ctx.state.meta.turn); u.n += sum(back.map(w => w.n)) }
  for (const c of Object.values(ctx.state.polity.cells)) { c.warHarm = (c.warHarm ?? 0) * (1 - ctx.T('war.harm.decay'))
    const occ = ctx.derive.war.occupiedShare(c.key); if (occ > 0) c.warHarm += ctx.T('war.occ.harm') * occ; if (c.warHarm < 1e-6) c.warHarm = 0 } }
export function step4(ctx) { moveArmies(ctx); supply(ctx); clashes(ctx); sieges(ctx); recover(ctx); stepInternal(ctx) }
