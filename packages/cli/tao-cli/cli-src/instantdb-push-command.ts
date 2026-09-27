import { Errors, FS, HCI, Platform } from '@shared'
import type { Readable, Writable } from 'node:stream'
import type { InstantPushReport } from 'tao-instantdb/push'
import { chooseTaoApp } from './dev-app-selection'
import { readInstantPushInputs } from './instantdb-push-inputs'

/**
 * `tao instantdb push` prepares an InstantDB app for a Tao app: it compiles the app, generates the
 * InstantDB schema and permission rules from the store its InstantDB datasource fills, and pushes
 * both. Only additive schema changes are applied; anything else is refused before the server
 * changes. The token authorizes the push and is never printed, logged, or stored.
 */

/** instantTokenVariable names the environment variable the push token is read from. */
export const instantTokenVariable = 'INSTANT_APP_ADMIN_TOKEN'

type InstantPushModule = typeof import('tao-instantdb/push')

/** InstantDBPushOptions selects the app and whether to apply anything. */
type InstantDBPushOptions = {
  appName?: string
  /** dryRun generates and plans, printing what a push would change, and applies nothing. */
  dryRun?: boolean
  env?: Readonly<Record<string, string | undefined>>
  /** fetch replaces the network for tests. */
  fetch?: typeof fetch
  input?: Readable
  interactive?: boolean
  output?: Writable
}

/** runInstantDBPush pushes one app's generated InstantDB schema and rules, or plans them. */
export async function runInstantDBPush(path: string, options: InstantDBPushOptions = {}): Promise<void> {
  const app = await chooseTaoApp(path, options.appName, 'InstantDB push')
  const inputs = await readInstantPushInputs(app.appPath, app.appName)
  const provider: InstantPushModule = await import('tao-instantdb/push')
  const mapping = provider.instantMapping(inputs.definition, inputs.policy?.accountEntity)
  const rules = provider.instantRules(mapping, inputs.policy)
  const token = await pushToken(options)
  const out = { output: options.output }
  HCI.writeLine(
    `InstantDB app ${inputs.appId} at ${inputs.apiURI} (${app.appName}, ${FS.displayPath(app.appPath)})`,
    out,
  )
  const report = await provider.pushInstantSchema(
    {
      apiURI: inputs.apiURI,
      appId: inputs.appId,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      token: token.value,
      tokenLabel: token.label,
    },
    { rules, schema: mapping.schema },
    { planOnly: options.dryRun === true },
  )
  writeSchemaChanges(report, options.dryRun === true, out)
  const namespaces = Object.keys(rules).filter(namespace => namespace !== '$default' && namespace !== 'attrs')
  const scope = inputs.policy === undefined
    ? 'no access rules are declared, so every namespace is public'
    : `from the declared access rules for ${namespaces.join(', ')}; other namespaces and new attributes are denied`
  if (options.dryRun === true) {
    HCI.writeLine(`Rules not applied (dry run): ${scope}.`, out)
    return
  }
  HCI.writeSuccess(`Rules applied: ${scope}.\n`, out)
}

function writeSchemaChanges(report: InstantPushReport, dryRun: boolean, out: { output?: Writable }): void {
  if (report.changes.length === 0) {
    HCI.writeLine('Schema already current.', out)
    return
  }
  HCI.writeLine(dryRun ? 'Schema changes a push would apply (dry run):' : 'Schema changes applied:', out)
  for (const change of report.changes) {
    HCI.writeLine(`  ${change}`, out)
  }
}

/**
 * pushToken reads the token from the environment, or asks for it without echo at a terminal. The
 * label says where the token came from, which is all a refusal ever reports about it.
 */
async function pushToken(options: InstantDBPushOptions): Promise<{ label: string; value: string }> {
  const fromEnvironment = (options.env ?? Platform.runtimeProcess.env)[instantTokenVariable]?.trim()
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    return { label: `token from ${instantTokenVariable}`, value: fromEnvironment }
  }
  const terminal = { input: options.input, interactive: options.interactive, output: options.output }
  if (!HCI.isInteractive(terminal)) {
    Errors.throwUserInput(
      `Set ${instantTokenVariable} to the InstantDB app's admin token, or run this command in a terminal to enter it.`,
    )
  }
  const entered = (await HCI.askSecret({ ...terminal, message: 'InstantDB app admin token:' })).value.trim()
  if (entered === '') {
    Errors.throwUserInput('No InstantDB token was entered; nothing was pushed.')
  }
  return { label: 'token entered at the prompt', value: entered }
}
