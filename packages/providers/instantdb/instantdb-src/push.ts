/**
 * The schema-push surface a deploy tool imports. It generates InstantDB's schema and rules from a
 * compiled Tao schema and pushes them over HTTP, and it never loads the React Native client, so a
 * command-line process can use it.
 */
export { type InstantPushReport, pushInstantSchema } from './instant-push'
export { type InstantRules, instantRules, type TaoDataPolicy } from './instant-rules'
export { instantMapping, type InstantSchemaJSON } from './instant-schema'
