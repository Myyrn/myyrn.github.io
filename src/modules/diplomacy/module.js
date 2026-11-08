// diplomacy/module.js — Diplomacy (diplomacy__kb, admin_war_diplomacy__spec §5-§6). Step 7: proposals -> decay -> (covert: not yet) -> war-declaration effects run via the scheduler handler.
import { makeDiplomacyState } from './common.js'
import { reputation, leverage, activeCBs, bestCBRank, externallyRecognised, greatPowerBacked, power, warForbidden, tradeDependency, treatyTier, axisGrants, decayStacks, addReputation, grantCB } from './readouts.js'
import { resolveProposals, installTreaty, warDeclared, militaryCap, tradeFactor, titularForced, laborMigrationBanned, foreignVetoes, recognizersOf, onBlocEnded, onFormation } from './treaties.js'
export { makeDiplomacyState }
export function step7(ctx) { resolveProposals(ctx); decayStacks(ctx) }
export const diplomacyModule = { id: 'diplomacy', steps: { 7: step7 }, handlers: { 'diplomacy.warDeclared': warDeclared }, foreignVetoes,
  derive: { reputation, leverage, activeCBs, bestCBRank, greatPowerBacked, power, warForbidden, tradeDependency, treatyTier, axisGrants, militaryCap, tradeFactor, titularForced, laborMigrationBanned, recognizersOf,
    externallyRecognisedCB: (ctx, cb) => externallyRecognised(ctx, cb), treaties: ctx => ctx.state.diplomacy.treaties.filter(t => t.status === 'active'), proposals: ctx => ctx.state.diplomacy.proposals,
    foreignStanding: (ctx, bloc, country) => (recognizersOf(ctx, bloc).includes(country) ? ctx.T('recog.standing') : 0) },
  services: { installTreaty, onBlocEnded, onFormation, addReputation, grantCB } }
