import { worldmapModule } from './worldmap/module.js'
import { administrationModule } from './administration/module.js'
import { economicsModule } from './economics/module.js'
import { polityModule } from './polity/module.js'
import { warModule } from './war/module.js'
import { diplomacyModule } from './diplomacy/module.js'
import { registerDiplomacyActions } from './diplomacy/actions.js'
import { registerWarActions } from './war/actions.js'
import { ActionRegistry } from '../engine/engine.js'
import { registerPolityActions } from './polity/actions.js'
import { registerRemainingActions } from './polity/remaining.js'
export const createModules = () => [worldmapModule, administrationModule, economicsModule, polityModule, warModule, diplomacyModule]
export function createRegistry() { const r = new ActionRegistry(); registerPolityActions(r); registerRemainingActions(r); registerWarActions(r); registerDiplomacyActions(r); return r }
