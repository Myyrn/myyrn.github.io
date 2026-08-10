import { newId, clamp, rand, choiceWeighted } from '../core.js';
import { RESOURCES, RAW_RESOURCE_KEYS, TERRAIN_AXES, BALANCE } from '../data.js';

// Provinces sit on a 2D grid (4-dimensional adjacency: N/E/S/W). This is the
// "4-dimensions grid" the brief asks for — each province has up to 4 neighbors.
export function generateWorld(rng) {
  const cols = BALANCE.GRID_COLS, rows = BALANCE.GRID_ROWS;
  const provinces = new Map();
  const grid = []; // grid[y][x] = provinceId

  for (let y = 0; y < rows; y++) {
    grid.push([]);
    for (let x = 0; x < cols; x++) {
      const id = newId('prov');
      const terrain = {};
      for (const axis of TERRAIN_AXES) terrain[axis] = clamp(rand(rng, 0, 1), 0, 1);
      // gentle regional coherence: smooth terrain a bit using position-based noise-ish bias
      terrain.fertility = clamp(terrain.fertility * 0.6 + (1 - Math.abs(y / rows - 0.5) * 1.6) * 0.4, 0, 1);
      terrain.aridity = clamp(terrain.aridity * 0.7 + (x / cols) * 0.3, 0, 1);

      const rawYields = {};
      const yieldCount = 1 + (rng() < 0.4 ? 1 : 0);
      const weighted = RAW_RESOURCE_KEYS.map(key => {
        const def = RESOURCES.find(r => r.key === key);
        let score = 1;
        for (const axis in (def.terrainBias || {})) {
          score += def.terrainBias[axis] * (terrain[axis] - 0.5) * 2;
        }
        return [key, Math.max(0.05, score)];
      });
      const chosen = new Set();
      for (let i = 0; i < yieldCount; i++) {
        const k = choiceWeighted(rng, weighted.filter(([key]) => !chosen.has(key)));
        chosen.add(k);
      }
      for (const k of chosen) rawYields[k] = Math.round(rand(rng, 3, 10));

      const province = {
        id, x, y, terrain,
        habitability: 'Wasteland', // set below
        cataclysm: { state: 'none', intensity: 0, originTick: 0, originCause: 'worldgen', reclamationProgress: 0 },
        rawResourceYields: rawYields,
        ownerCountryId: null,
        settlementProgress: null,
        developmentLevel: 0,
        fortificationLevel: 0,
      };
      provinces.set(id, province);
      grid[y].push(id);
    }
  }

  // adjacency (4-neighbor)
  function neighborsOf(x, y) {
    const out = [];
    if (y > 0) out.push(grid[y - 1][x]);
    if (y < rows - 1) out.push(grid[y + 1][x]);
    if (x > 0) out.push(grid[y][x - 1]);
    if (x < cols - 1) out.push(grid[y][x + 1]);
    return out;
  }
  for (const p of provinces.values()) p.adjacentProvinceIds = neighborsOf(p.x, p.y);

  // Habitability: ~50% Settled, rest Wasteland — settled provinces form a handful of
  // organic blobs (flood-fill growth from random seeds) rather than pure noise, so
  // territory assignment later produces contiguous countries.
  const targetSettled = Math.round(cols * rows * BALANCE.SETTLED_SHARE);
  const allIds = [...provinces.keys()];
  const seedCount = 18;
  const seeds = [];
  for (let i = 0; i < seedCount; i++) seeds.push(allIds[Math.floor(rng() * allIds.length)]);
  const frontier = [...seeds];
  const settled = new Set();
  for (const s of seeds) settled.add(s);
  while (settled.size < targetSettled && frontier.length) {
    const idx = Math.floor(rng() * frontier.length);
    const cur = frontier[idx];
    const p = provinces.get(cur);
    const cand = p.adjacentProvinceIds.filter(n => !settled.has(n));
    if (!cand.length) { frontier.splice(idx, 1); continue; }
    const next = cand[Math.floor(rng() * cand.length)];
    settled.add(next);
    frontier.push(next);
    if (rng() < 0.08) frontier.splice(idx, 1); // occasionally retire a frontier point
  }
  for (const id of settled) {
    const p = provinces.get(id);
    p.habitability = 'Settled';
    p.developmentLevel = clamp(rand(rng, 0.15, 0.45), 0, 1);
    p.fortificationLevel = clamp(rand(rng, 0, 0.2), 0, 1);
  }

  return { provinces, grid, cols, rows };
}

export function pathDistance(world, aId, bId) {
  // BFS over adjacency; small maps (500 nodes) so a plain BFS per call is fine for alpha.
  if (aId === bId) return 0;
  const visited = new Set([aId]);
  let frontier = [aId];
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const id of frontier) {
      const p = world.provinces.get(id);
      for (const n of p.adjacentProvinceIds) {
        if (visited.has(n)) continue;
        if (n === bId) return dist;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
    if (dist > 200) return Infinity;
  }
  return Infinity;
}
