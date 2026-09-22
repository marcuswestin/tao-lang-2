// The provider implementation stays in `packages/ides/studio`, beside `StudioProtocol.ts` and the
// rest of the client's server-facing modules. A `provider … from ./X.ts` sidecar must be a literal
// sibling of the declaring `.tao` file, so this file exists only to satisfy that and re-export the
// real implementation with a relative export rather than a bare package import.
export { StudioServerProvider } from '../../packages/ides/studio/studio-src/StudioServerDataProvider'
