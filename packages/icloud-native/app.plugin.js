// This package is ESM, so Expo's conventional app.plugin.js entry must be ESM too. Expo unwraps the
// default export while the implementation remains CommonJS for config-plugin host compatibility.
import plugin from './plugins/with-tao-icloud.cjs'

export default plugin
