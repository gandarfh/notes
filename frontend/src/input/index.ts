/**
 * Input system barrel — import this once from App.tsx to register all layers.
 * Side-effect imports register the layers with InputManager.
 */
import './layers/layer1-modal'
import './layers/layer2-editing'
import './layers/layer3-drawing'

export { bindGlobalKeydown } from './InputManager'
export { registerLayer, unregisterLayer } from './InputManager'
export { initLayer0 } from './layers/layer0-always'
export { registerModal } from './layers/layer1-modal'
export { setDrawingKeyHandler } from './layers/layer3-drawing'
export { initLayer4 } from './layers/layer4-block'
