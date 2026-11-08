import { politySvc } from './derive.js'
import { step5 } from './step.js'
import { remainingDerive, remainingHandlers } from './remaining.js'
import { gateHolders, stanceFns, entitlementLoss, decideCellActions, decayFns, acceptance, cellRung, factions, crisisSeverity } from './behaviour.js'
export const polityModule = { id: 'polity', derive: { ...politySvc, ...remainingDerive, acceptance, cellRung, factions, crisisSeverity }, steps: { 5: step5 }, decayFns, handlers: remainingHandlers,
  gateHolders, stanceFns, entitlementLoss, decideCellActions }
