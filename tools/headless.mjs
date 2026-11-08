// tools/headless.mjs — run N turns of a scenario package from disk and print a summary.   node tools/headless.mjs demo 20
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
const [, , id = 'demo', n = '10'] = process.argv
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const pkg = await readPackage(readJson, `scenarios/${id}`), ruleset = await readJson('data/ruleset.json')
const c = new EngineClient(); await c.init(pkg, ruleset)
for (let i = 0; i < Number(n); i++) { await c.endTurn(); const s = c.summary()
  console.log(`t${s.turn}`, Object.entries(s.countries).map(([k, v]) => `${k}: pop ${Math.round(v.population)} ledger ${v.ledger.toFixed(0)} subs ${v.subsistence.toFixed(2)} grv ${v.grievance.toFixed(2)} Q ${v.questions}`).join(' | ')) }
