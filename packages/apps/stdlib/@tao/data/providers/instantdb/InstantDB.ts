// The InstantDB client and its `@instantdb/react-native` vendor dependency live in `tao-instantdb`
// (`packages/apps/providers/instantdb`). This sidecar stays a sibling of `InstantDB.tao` — a
// `provider … from ./X.ts` file must be a sibling of its `.tao` — so the `@tao/...` import path a
// Tao app writes does not change.
export { InstantDBProvider } from 'tao-instantdb'
