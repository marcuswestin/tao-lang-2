const { withPodfileProperties } = require('expo/config-plugins')

// Jazz alpha.57 checks this legacy property during pod install. Expo SDK 57
// enables the New Architecture but no longer writes the property by default.
module.exports = config =>
  withPodfileProperties(config, current => {
    current.modResults.newArchEnabled = 'true'
    return current
  })
