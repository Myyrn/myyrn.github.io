// war/stock.js — region warehouse stock helpers shared by fieldUnits and the rebel muster.
const sum = a => a.reduce((s, x) => s + x, 0)
export const regionStock = (ctx, region, g) => sum(ctx.derive.worldmap.regionProvinces(region).map(p => ctx.state.economy.warehouses[p]?.stock?.[g] ?? 0))
export function takeRegionStock(ctx, region, g, q) { let need = q; for (const p of ctx.derive.worldmap.regionProvinces(region)) { const s = ctx.state.economy.warehouses[p]?.stock; if (!s || need <= 0) continue; const t = Math.min(need, s[g] ?? 0); s[g] = (s[g] ?? 0) - t; need -= t } }
