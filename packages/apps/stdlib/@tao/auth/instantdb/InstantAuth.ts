// The InstantDB auth client and its `@instantdb/react-native` vendor dependency live in
// `tao-instantdb` (`packages/providers/instantdb`). This sidecar stays a sibling of `InstantAuth.tao`
// — a `provider … from ./X.ts` file must be a sibling of its `.tao` — so the `@tao/...` import path a
// Tao app writes does not change.
export { InstantAuthProvider } from 'tao-instantdb'
