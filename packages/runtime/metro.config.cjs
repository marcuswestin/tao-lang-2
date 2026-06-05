const { getDefaultConfig } = require('expo/metro-config')
const nodePath = require('node:path')

// Metro config loads as plain CJS, so keep this node:path use local.
const config = getDefaultConfig(__dirname)

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@runtime/TR') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(__dirname, 'TaoRuntime-src', 'TR.ts'),
    }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
