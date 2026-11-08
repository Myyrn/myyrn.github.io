// ai/simpleWar.js — minimal AI Government: same Action API as the player. (AI-War proper is a later module.)
import { atWar } from '../war/step.js'
import { controller } from '../war/internal.js'
export function simpleWarOrders(ctx) {
  const out = [], W = ctx.state.war
  for (const [cid, c] of Object.entries(ctx.state.countries)) {
    if (c.isPlayer) continue
    const enemies = [...Object.keys(ctx.state.countries), ...Object.keys(W.blocs ?? {})].filter(o => o !== cid && atWar(ctx, cid, o)); if (!enemies.length) continue
    const mine = Object.values(W.armies).filter(a => a.owner === cid)
    if (!mine.length) {                                                                              // raise one army in the Region nearest the enemy
      const border = Object.entries(ctx.state.world.provinces).filter(([, p]) => p.owner === cid).map(([id]) => id).filter(id => ctx.derive.worldmap.neighbors(id).some(n => enemies.includes(controller(ctx, n))))
      const at = border.sort()[0], region = at && ctx.state.world.regionSnapshot.assignment[at]
      const cell = Object.values(ctx.state.polity.cells).filter(x => x.region === region && x.estate === 'peasants').sort((a, b) => b.population - a.population)[0]
      if (cell) { const n = Math.floor(((cell.labour['Shock Infantry'] ?? 0) - (cell.labourCommitted['Shock Infantry'] ?? 0)) * 0.6); if (n > 0) out.push({ id: `ai.${cid}.field.${ctx.state.meta.turn}`, actor: { kind: 'government', country: cid }, type: 'fieldUnits', params: { originCell: cell.key, composition: { 'Shock Infantry': n }, at } }) }
    }
    for (const a of mine) { if (a.path?.length) continue                                              // idle: march on the nearest enemy army, else the nearest enemy province
      const foes = Object.values(W.armies).filter(o => enemies.includes(o.owner))
      const target = foes.length ? foes[0].position : Object.entries(ctx.state.world.provinces).find(([id]) => enemies.includes(controller(ctx, id)) && (!W.occupations[id] || W.blocs?.[W.occupations[id].occupier]))?.[0]
      if (target && target !== a.position) out.push({ id: `ai.${cid}.move.${a.id}.${ctx.state.meta.turn}`, actor: { kind: 'government', country: cid }, type: 'orderMove', params: { armyId: a.id, to: target } }) } }
  return out }
