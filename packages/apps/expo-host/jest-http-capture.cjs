// The native Expo preset replaces these globals with non-networking native mocks.
globalThis.__taoHostHttp = Object.fromEntries(
  ['fetch', 'Request', 'Response', 'Headers'].map(name => [name, globalThis[name]]),
)
