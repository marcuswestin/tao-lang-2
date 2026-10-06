import { Errors, FS, HCI, Platform } from '@shared'
import type { Readable, Writable } from 'node:stream'
import type { InstantPushReport } from 'tao-instantdb/push'
import { chooseTaoApp } from './dev-app-selection'
import { instantCloudApiURI, readInstantPushInputs } from './instantdb-push-inputs'
import { projectSecretIfStored } from './project-secrets-command'

/**
 * `tao instantdb push` prepares an InstantDB app for a Tao app: it compiles the app, generates the
 * InstantDB schema and permission rules from the store its InstantDB datasource fills, and pushes
 * both. Only additive schema changes are applied; anything else is refused before the server
 * changes, unless the push is forced. The token authorizes the push and is never printed, logged,
 * or exposed in generated output. A project secret may supply it when no environment override exists.
 */

/** instantTokenVariable names the environment variable the push token is read from. */
const instantTokenVariable = 'INSTANT_APP_ADMIN_TOKEN'

type InstantPushModule = typeof import('tao-instantdb/push')

/** InstantDBPushOptions selects the app and whether to apply anything. */
type InstantDBPushOptions = {
  appName?: string
  /** dryRun generates and plans, printing what a push would change, and applies nothing. */
  dryRun?: boolean
  env?: Readonly<Record<string, string | undefined>>
  /** fetch replaces the network for tests. */
  fetch?: typeof fetch
  /** force applies a plan that is not purely additive; attributes the app no longer declares stay put. */
  force?: boolean
  input?: Readable
  interactive?: boolean
  output?: Writable
  projectSecret?: (name: string, projectRoot: string) => Promise<string | undefined>
}

/** runInstantDBPush pushes one app's generated InstantDB schema and rules, or plans them. */
export async function runInstantDBPush(path: string, options: InstantDBPushOptions = {}): Promise<void> {
  const app = await chooseTaoApp(path, options.appName, 'InstantDB push')
  const inputs = await readInstantPushInputs(app.appPath, app.appName)
  const provider: InstantPushModule = await import('tao-instantdb/push')
  const mapping = provider.instantMapping(inputs.definition, inputs.policy?.accountEntity)
  const rules = provider.instantRules(mapping, inputs.policy)
  const out = { output: options.output }
  HCI.writeLine(
    `InstantDB app ${inputs.appId} at ${inputs.apiURI} (${app.appName}, ${FS.displayPath(app.appPath)})`,
    out,
  )
  const token = await pushToken(app.projectRoot, inputs, options)
  const report = await provider.pushInstantSchema(
    {
      apiURI: inputs.apiURI,
      appId: inputs.appId,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      token: token.value,
      tokenLabel: token.label,
    },
    { rules, schema: mapping.schema },
    { force: options.force === true, planOnly: options.dryRun === true },
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
  const list = (heading: string, items: readonly string[]) => {
    if (items.length > 0) {
      HCI.writeLine(heading, out)
      for (const item of items) {
        HCI.writeLine(`  ${item}`, out)
      }
    }
  }
  if (report.changes.length + report.forced.length === 0) {
    HCI.writeLine('Schema already current.', out)
  }
  list(dryRun ? 'Schema changes a push would apply (dry run):' : 'Schema changes applied:', report.changes)
  list(
    dryRun ? 'Non-additive changes a forced push would apply (dry run):' : 'Non-additive changes applied (forced):',
    report.forced,
  )
  list(
    'Left on the server, not declared by the Tao schema (delete them in the InstantDB dashboard):',
    report.undeclared,
  )
}

/**
 * pushToken reads the environment override or the project store, then asks without echo. The
 * label says where the token came from, which is all a refusal ever reports about it.
 */
async function pushToken(
  projectRoot: string,
  address: { appId: string; apiURI: string },
  options: InstantDBPushOptions,
): Promise<{ label: string; value: string }> {
  const fromEnvironment = (options.env ?? Platform.runtimeProcess.env)[instantTokenVariable]?.trim()
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    return { label: `token from ${instantTokenVariable}`, value: fromEnvironment }
  }
  const fromProject = await (options.projectSecret ?? projectSecretIfStored)(instantTokenVariable, projectRoot)
  if (fromProject !== undefined) {
    return { label: 'token from Tao project secrets', value: fromProject }
  }
  const terminal = { input: options.input, interactive: options.interactive, output: options.output }
  const cloud = URL.parse(address.apiURI)?.origin === new URL(instantCloudApiURI).origin
  if (!HCI.isInteractive(terminal)) {
    const source = cloud
      ? `Get the Admin token for app ${address.appId} from that app in https://instantdb.com/dash.`
      : `Get the admin token for app ${address.appId} from the app provisioning or dashboard of ${address.apiURI}.`
    Errors.throwUserInput(
      `${source} Store ${instantTokenVariable} with \`tao secrets set\`, set the environment variable, or run this command in a terminal to enter it.`,
    )
  }
  const out = { output: options.output }
  if (cloud) {
    HCI.writeLine('1. Open https://instantdb.com/dash and sign in to an account with access to this app.', out)
    HCI.writeLine(`2. Select the existing app whose App ID is ${address.appId}, then copy its Admin token.`, out)
    HCI.writeLine('   Use the app admin token, not a personal access token or user sign-in token.', out)
  } else {
    HCI.writeLine(`1. This app uses a local or self-hosted InstantDB service at ${address.apiURI}.`, out)
    HCI.writeLine(
      `2. Sign in to that installation's dashboard with access to App ID ${address.appId}; select that app's Admin page and copy its Admin token.`,
      out,
    )
    HCI.writeLine(
      'The repository local stack dashboard is http://localhost:3000; its seeded app has no saved admin token.',
      out,
    )
    HCI.writeLine(
      'For dashboard access or setup, ask the installation owner: https://www.instantdb.com/docs/self-hosting',
      out,
    )
  }
  HCI.writeLine('3. Paste only that app admin token at the hidden prompt, then press Enter.', out)
  HCI.writeLine('Tao uses it to push schema and permissions; it is not included in client app configuration.', out)
  const entered = (await HCI.askSecret({ ...terminal, message: 'InstantDB app admin token:' })).value.trim()
  if (entered === '') {
    Errors.throwUserInput('No InstantDB token was entered; nothing was pushed.')
  }
  return { label: 'token entered at the prompt', value: entered }
}
