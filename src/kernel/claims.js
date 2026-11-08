// kernel/claims.js — zero-sum locking of pools/stocks for one turn. No partial residual.
export class ClaimLedger {
  constructor(produced /* (resKey)=>number */) { this.produced = produced; this.locked = new Map() }
  static key(res) { return `${res.kind}|${res.holder}|${res.pool ?? res.good ?? res.stock}` }
  committed(res) { return this.locked.get(ClaimLedger.key(res)) ?? 0 }
  available(res) { return this.produced(res) - this.committed(res) }
  lock(res, amount) {
    if (amount > this.available(res) + 1e-9) return false
    this.locked.set(ClaimLedger.key(res), this.committed(res) + amount); return true
  }
  /** claims: [{res, amount}] all-or-nothing */
  lockAll(claims) {
    const snap = new Map(this.locked)
    for (const c of claims) if (!this.lock(c.res, c.amount)) { this.locked = snap; return false }
    return true
  }
}
