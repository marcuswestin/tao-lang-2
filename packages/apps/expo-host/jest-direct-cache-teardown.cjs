const cache = require('./jest-direct-cache.cjs')

module.exports = async () => {
  const state = globalThis.__taoDirectJestCache
  if (state) {
    await cache.finish(state.identityRoot, state.lease)
  }
}
