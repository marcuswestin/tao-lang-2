const cache = require('./jest-direct-cache.cjs')

module.exports = async () => {
  const identityRoot = cache.root(__dirname)
  globalThis.__taoDirectJestCache = { identityRoot, lease: await cache.start(identityRoot) }
}
