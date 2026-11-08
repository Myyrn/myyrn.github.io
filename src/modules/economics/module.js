import { economicsDerive } from './derive.js'
import { step3, drawFromZone } from './step.js'
export const economicsModule = { id: 'economics', derive: economicsDerive, steps: { 3: step3 }, services: { draw: drawFromZone } }
