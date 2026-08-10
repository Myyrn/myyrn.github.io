import { newId, clamp, rand, pick, newStanding } from '../core.js';
import {
  BALANCE, NATION_NAME_POOL, COUNTRY_NAME_POOL, SPECIALIZATIONS, ESTATE_DEFS,
} from '../data.js';

const COUNTRY_COLORS = [
  '#c9a15a', '#6f9a8d', '#b3543f', '#7c8fc9', '#a9c96a',
  '#c97fb0', '#4c8c94', '#d0975a', '#8f7ec9', '#7fb0c9',
];

// Population-split patterns referenced by the brief:
//  A: titular 75% / shared minority 25%
//  B: four nations at 25% each
//  C: titular 50% / 30% / 10% / 10%
const SPLIT_PATTERNS = ['A', 'C', 'B', 'C', 'A', 'C', 'B', 'A', 'C', 'A'];

export function generateCountries(rng, world) {
  const n = BALANCE.PLAYER_COUNT;
  const nationNames = shuffle(rng, NATION_NAME_POOL).slice(0, Math.max(n + 2, 12));
  const countryNames = shuffle(rng, COUNTRY_NAME_POOL);

  // ---- Nations: one per country (titular) + a handful of extra minority nations,
  // + one designated SHARED nation used for the irredentism/nationalism scenario.
  const nations = new Map();
  function makeNation(name) {
    const id = newId('nation');
    nations.set(id, {
      id, name,
      reactionTemperament: clamp(rand(rng, 0.2, 0.9), 0, 1),
      preferenceProfile: [],
      traditionMentality: { decisionWeightMultipliers: {} },
    });
    return id;
  }
  const titularNationId = [];
  for (let i = 0; i < n; i++) titularNationId.push(makeNation(nationNames[i]));
  const extraNationId = [];
  for (let i = n; i < nationNames.length; i++) extraNationId.push(makeNation(nationNames[i]));
  const sharedNationId = titularNationId[0] === undefined ? makeNation('Halewynd') : extraNationId[0] || makeNation('Halewynd');

  // ---- Countries ------------------------------------------------------------
  const countries = new Map();
  const specCycle = SPECIALIZATIONS.map(s => s.key);
  for (let i = 0; i < n; i++) {
    const id = newId('ctry');
    const spec = specCycle[i % specCycle.length];
    const estates = {};
    for (const def of ESTATE_DEFS) {
      const structuralBaseline = clamp(rand(rng, -0.1, 0.35), -1, 1);
      estates[def.key] = {
        key: def.key,
        rights: clamp(def.baseRights + rand(rng, -0.1, 0.1), 0, 1),
        controlDomain: def.controlDomain,
        loyalty: newStanding(structuralBaseline),
        prestige: rand(rng, 0.2, 0.6),
        vetoTier: def.key === 'nobility' ? 'weak' : 'none',
      };
    }
    countries.set(id, {
      id,
      name: countryNames[i] || `Realm ${i + 1}`,
      color: COUNTRY_COLORS[i % COUNTRY_COLORS.length],
      isPlayer: i === 0,
      specialization: spec,
      government: {
        triangle: normalizeTriangle(rng),
        institutionalPersonalistic: clamp(rand(rng, -1, 1), -1, 1),
      },
      territoryProvinceIds: [],
      capitalProvinceId: null,
      estates,
      titularNationId: titularNationId[i],
      nationShares: {}, // nationId -> Ratio, filled below
      resourceStock: {},
      lifecycleState: 'active',
      standing: { prestige: 0, reputation: 0, culturalInfluence: 0, economicLeverage: 0 },
    });
  }

  // ---- Nation population split per country, per SPLIT_PATTERNS ---------------
  const countryIds = [...countries.keys()];
  countryIds.forEach((cid, i) => {
    const c = countries.get(cid);
    const pattern = SPLIT_PATTERNS[i % SPLIT_PATTERNS.length];
    const titular = c.titularNationId;
    const shares = {};
    if (pattern === 'A') {
      shares[titular] = 0.75;
      shares[sharedNationId] = shares[sharedNationId] ? shares[sharedNationId] + 0.25 : 0.25;
    } else if (pattern === 'B') {
      const others = pickN(rng, extraNationId.concat(titularNationId.filter(x => x !== titular)), 3);
      shares[titular] = 0.25;
      others.forEach(nid => { shares[nid] = 0.25; });
    } else { // C: 50/30/10/10
      const others = pickN(rng, extraNationId.concat(titularNationId.filter(x => x !== titular)), 3);
      shares[titular] = 0.5;
      shares[others[0]] = 0.3;
      shares[others[1]] = 0.1;
      shares[others[2]] = 0.1;
    }
    c.nationShares = shares;
  });
  // Guarantee the shared nation is present as a *minority* in at least 2 non-home countries
  // (irredentism scenario) even if pattern rolls didn't already place it there.
  const homeIdx = countryIds.findIndex(cid => countries.get(cid).titularNationId === sharedNationId);
  const nonHome = countryIds.filter((cid, i) => i !== homeIdx);
  const forcedHosts = pickN(rng, nonHome, 2);
  for (const cid of forcedHosts) {
    const c = countries.get(cid);
    if (!c.nationShares[sharedNationId]) {
      // shrink titular slightly to make room
      const t = c.titularNationId;
      const take = Math.min(0.15, c.nationShares[t] * 0.2);
      c.nationShares[t] -= take;
      c.nationShares[sharedNationId] = take;
    }
  }

  // ---- Territory assignment: balanced round-robin flood-fill from seeds ------
  // Each country grows one province per round from its own frontier. If a country's
  // frontier runs dry before it reaches its fair share, it reseeds elsewhere (a small
  // exclave) rather than staying stuck at 1 province — keeps realm sizes comparable.
  const settledIds = [...world.provinces.values()].filter(p => p.habitability === 'Settled').map(p => p.id);
  const seeds = pickN(rng, settledIds, n);
  const claimedBy = new Map(); // provinceId -> countryIdx
  const frontiers = [];
  const provincesByCountry = countryIds.map(() => []);
  const unclaimedPool = new Set(settledIds);
  seeds.forEach((s, i) => {
    claimedBy.set(s, i); provincesByCountry[i].push(s); unclaimedPool.delete(s); frontiers.push([s]);
  });
  const target = Math.floor(settledIds.length / n);

  function growOne(i) {
    while (frontiers[i].length) {
      const cur = frontiers[i][frontiers[i].length - 1];
      const p = world.provinces.get(cur);
      const cand = p.adjacentProvinceIds.filter(nb => {
        const pn = world.provinces.get(nb);
        return pn.habitability === 'Settled' && !claimedBy.has(nb);
      });
      if (cand.length) {
        const chosen = cand[Math.floor(rng() * cand.length)];
        claimedBy.set(chosen, i); provincesByCountry[i].push(chosen); unclaimedPool.delete(chosen);
        frontiers[i].push(chosen);
        return true;
      }
      frontiers[i].pop();
    }
    // frontier exhausted — reseed into an unclaimed pocket elsewhere (small exclave)
    if (unclaimedPool.size) {
      const arr = [...unclaimedPool];
      const newSeed = arr[Math.floor(rng() * arr.length)];
      claimedBy.set(newSeed, i); provincesByCountry[i].push(newSeed); unclaimedPool.delete(newSeed);
      frontiers[i] = [newSeed];
      return true;
    }
    return false;
  }

  let safety = settledIds.length * 3;
  while (unclaimedPool.size && safety-- > 0) {
    for (let i = 0; i < n && unclaimedPool.size; i++) {
      if (provincesByCountry[i].length >= target * 1.6) continue; // let laggards catch up first
      growOne(i);
    }
  }
  // mop up any remainder purely round-robin, ignoring the soft cap
  let idx = 0;
  while (unclaimedPool.size && safety-- > 0) { growOne(idx % n); idx++; }

  for (const [provId, i] of claimedBy.entries()) {
    const cid = countryIds[i];
    world.provinces.get(provId).ownerCountryId = cid;
    countries.get(cid).territoryProvinceIds.push(provId);
  }
  countryIds.forEach((cid, i) => {
    const c = countries.get(cid);
    c.capitalProvinceId = c.territoryProvinceIds[0] || seeds[i];
  });

  // ---- Diplomatic relations shell (all pairs, all at peace) -------------------
  const relations = new Map(); // key "a|b" canonical a<b
  for (let i = 0; i < countryIds.length; i++) {
    for (let j = i + 1; j < countryIds.length; j++) {
      const a = countryIds[i], b = countryIds[j];
      relations.set(relKey(a, b), {
        countryIdA: a, countryIdB: b,
        opinion: newStanding(rand(rng, -0.1, 0.15)),
        status: 'peace',
        claims: [],
        casusBelli: [],
      });
    }
  }

  // ---- Claims: each country has claims on territory of exactly two others -----
  countryIds.forEach((cid, i) => {
    const c = countries.get(cid);
    const targets = pickN(rng, countryIds.filter(x => x !== cid), 2);
    for (const targetId of targets) {
      const target = countries.get(targetId);
      if (!target.territoryProvinceIds.length) continue;
      const targetProv = pick(rng, target.territoryProvinceIds);
      const rel = relations.get(relKey(cid, targetId));
      rel.claims.push({
        id: newId('claim'), claimantCountryId: cid, targetProvinceId: targetProv,
        claimType: 'territorial', legitimacy: clamp(rand(rng, 0.3, 0.8), 0, 1),
      });
    }
  });

  // ---- Casus belli: each country holds one "avenge_insult" CB on one other -----
  countryIds.forEach((cid, i) => {
    const targetId = countryIds[(i + 3 + Math.floor(rng() * 3)) % countryIds.length] === cid
      ? countryIds[(i + 1) % countryIds.length]
      : countryIds[(i + 3 + Math.floor(rng() * 3)) % countryIds.length];
    const rel = relations.get(relKey(cid, targetId));
    rel.casusBelli.push({
      id: newId('cb'), holderCountryId: cid, targetCountryId: targetId,
      triggerType: 'avenge_insult', severity: clamp(rand(rng, 0.4, 0.9), 0, 1),
      earnedTick: 0, decayHalfLifeTicks: 60, used: false,
    });
  });

  return { countries, nations, relations, sharedNationId, countryIds };
}

function relKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
export { relKey };

function normalizeTriangle(rng) {
  const r = [rng(), rng(), rng()];
  const s = r[0] + r[1] + r[2];
  return { republic: r[0] / s, feudal: r[1] / s, theocracy: r[2] / s };
}
function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickN(rng, arr, count) {
  return shuffle(rng, arr).slice(0, Math.min(count, arr.length));
}
