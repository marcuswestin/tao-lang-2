// The companion builds the same React Native 0.81 pods as the runtime toolchain under the same Xcode,
// so it shares the toolchain's fmt compatibility plugin instead of carrying a copy of the patch.
module.exports = require('../../../apps/expo-host/plugins/with-ios-fmt-compat.cjs')
