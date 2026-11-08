// war/combat.js — battle: sub-units resolve pairwise through three sequential phases; state carries forward.
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x)), sum = a => a.reduce((s, x) => s + x, 0)
const stat = (ctx, u) => ctx.ruleset.pools[u.pool].combat
const tag = (ctx, u) => stat(ctx, u).tags[0]
const tacticMod = a => ({ aggressive: { atk: 1.15, def: 0.9 }, defensive: { atk: 0.9, def: 1.15 }, balanced: { atk: 1, def: 1 } })[a.tactic ?? 'balanced']
const terrainMod = (ctx, terrain, u) => ctx.ruleset.terrain[terrain]?.combat?.[u.pool] ?? 1
const supplyMod = u => 0.5 + 0.5 * (u.supply ?? 1)
export function power(ctx, u, army, terrain, kind) {
  const s = stat(ctx, u), base = kind === 'ranged' ? s.rangedAtk : s.meleeAtk
  return base * u.n * terrainMod(ctx, terrain, u) * u.cohesion * supplyMod(u) * tacticMod(army).atk }
const defence = (ctx, u, army) => Math.max(0.1, stat(ctx, u).meleeDef * tacticMod(army).def)
function hit(ctx, u, dmg, army, log) {                                // casualties: Killed (permanent, from the origin cell) / Wounded (return after a delay)
  const loss = Math.min(u.n, dmg * ctx.T('war.casualty.rate') / defence(ctx, u, army)); if (loss <= 0) return 0
  u.n -= loss; const killed = loss * (1 - ctx.T('war.wounded.share')), wounded = loss - killed
  if (wounded > 0) (u.wounded ??= []).push({ n: wounded, returnTurn: ctx.state.meta.turn + ctx.T('war.wounded.delay') })
  const cell = ctx.state.polity.cells[u.originCell]
  if (cell) { cell.labour[u.pool] = Math.max(0, (cell.labour[u.pool] ?? 0) - killed); cell.labourCommitted[u.pool] = Math.max(0, (cell.labourCommitted[u.pool] ?? 0) - loss)
    cell.population = Math.max(1, cell.population - killed); cell.warHarm = (cell.warHarm ?? 0) + ctx.T('war.harm.k') * loss / Math.max(1, cell.population) }
  log.push({ cell: u.originCell, killed, wounded }); return loss }
/** A attacks D at `province`. Returns {winner:'A'|'D', score:{A,D}, log} and mutates units (n, cohesion, wounded). */
export function fight(ctx, A, D, province) {
  const terrain = ctx.state.world.provinces[province].terrain, U = ctx.state.war.units, log = []
  const la = A.units.map(id => U[id]).filter(u => u.n > 0).sort((x, y) => y.n - x.n || (x.id < y.id ? -1 : 1)), ld = D.units.map(id => U[id]).filter(u => u.n > 0).sort((x, y) => y.n - x.n || (x.id < y.id ? -1 : 1))
  const pairs = Math.min(la.length, ld.length); if (!pairs) return { winner: la.length ? 'A' : 'D', score: {}, log }
  const flankA = 1 + ctx.T('war.flank') * Math.min(1, (la.length - pairs) / pairs), flankD = 1 + ctx.T('war.flank') * Math.min(1, (ld.length - pairs) / pairs)
  const inter = (x, y) => ctx.ruleset.war.interaction[tag(ctx, x)]?.[tag(ctx, y)] ?? 1
  for (let i = 0; i < pairs; i++) {
    const a = la[i], d = ld[i], ranged = u => tag(ctx, u) === 'ranged'
    // 1. skirmish: ranged vs ranged full effect, ranged vs melee-tagged = harassment
    const harass = u => (ranged(u) ? 1 : ctx.ruleset.war.harassVsMelee)
    const sa = power(ctx, a, A, terrain, 'ranged') * flankA * harass(d), sd = power(ctx, d, D, terrain, 'ranged') * flankD * harass(a)
    hit(ctx, d, sa, D, log); hit(ctx, a, sd, A, log)
    // 2. melee (charge/reach interaction table)
    const ma = power(ctx, a, A, terrain, 'melee') * flankA * inter(a, d), md = power(ctx, d, D, terrain, 'melee') * flankD * inter(d, a)
    hit(ctx, d, ma, D, log); hit(ctx, a, md, A, log) }
  // 3. rout
  const score = { A: sum(la.map(u => u.n * u.cohesion)), D: sum(ld.map(u => u.n * u.cohesion)) }, winner = score.A > score.D ? 'A' : 'D'
  const [W, L, lw, ll] = winner === 'A' ? [A, D, la, ld] : [D, A, ld, la]
  for (const u of lw) u.cohesion = clamp(u.cohesion + ctx.T('war.cohesion.win'), 0, 1); for (const u of ll) u.cohesion = clamp(u.cohesion - ctx.T('war.cohesion.loss'), 0, 1)
  const agg = sum(ll.map(u => u.cohesion)) / (ll.length || 1)
  if (agg < ctx.T('war.rout.threshold')) { const speedRatio = Math.max(...lw.map(u => stat(ctx, u).speed)) / Math.max(...ll.map(u => stat(ctx, u).speed))
    for (const u of ll) hit(ctx, u, u.n * ctx.T('war.pursuit') * speedRatio, L, log) }              // clean break: pursuit casualties scale with speed
  return { winner, score, log, rout: agg < ctx.T('war.rout.threshold') } }
