import { CLI, Errors, FS, HCI, Platform, Time } from '@shared'
import type { Writable } from 'node:stream'

type AppwriteConnection = {
  endpoint: string
  projectId: string
  platform: string
  databaseId: string
  tableId: string
}

type Request = (path: string, method?: string, body?: Record<string, unknown>) => Promise<unknown>
type AppwriteFetch = (url: string, init?: RequestInit) => Promise<Response>

type AppwriteCliResult = { exitCode: number | null; stdout: string; stderr: string }
export type AppwriteRunner = (args: readonly string[], cwd: string, interactive: boolean) => Promise<AppwriteCliResult>

type AppwriteProjectOptions = {
  project: string
  currentProjectId?: string
  resources: Omit<AppwriteConnection, 'endpoint' | 'projectId'>
  prompts: { text: (message: string) => Promise<string> }
  output?: Writable
  runner?: AppwriteRunner
  fetch?: AppwriteFetch
  /** Replaces the pause between setup attempts for focused command tests. */
  sleep?: (milliseconds: number) => Promise<void>
}

/** Appwrite Cloud regions a new project can be placed in; each has its own API endpoint. */
const APPWRITE_REGIONS = ['fra', 'nyc', 'syd', 'sfo', 'sgp', 'tor'] as const
/** Exactly what provisionAppwrite reads and writes. */
const SETUP_KEY_SCOPES = [
  'project.read',
  'project.write',
  'platforms.read',
  'platforms.write',
  'databases.read',
  'databases.write',
  'tables.read',
  'tables.write',
  'columns.write',
  'indexes.write',
]
const SETUP_KEY_SECONDS = 900
/** A project created seconds earlier can reject its first key until Appwrite finishes creating it. */
const SETUP_ATTEMPTS = 6
const SETUP_RETRY_MILLISECONDS = 5_000

/**
 * Creates or reuses the Hosted CRUD Appwrite project through Appwrite's CLI and the developer's browser
 * sign-in, then configures it with a short-lived key that is never stored.
 */
export async function provisionAppwriteProject(
  options: AppwriteProjectOptions,
): Promise<{ endpoint: string; projectId: string }> {
  const run = options.runner ?? runAppwriteCli
  const work = FS.resolvePath('.tao/appwrite-connect', options.project)
  if (await FS.isSymbolicLink(work)) {
    Errors.throwUserInput('Appwrite setup directory cannot be a symbolic link; no cloud changes were made.')
  }
  // The Appwrite CLI may write appwrite.config.json beside where it runs; keep that out of the app.
  await FS.mkdir(work)
  const out = { output: options.output }

  if (!await appwriteAccount(run, work)) {
    HCI.writeLine('A browser will open for one-time sign-in to the Appwrite CLI.', out)
    HCI.writeLine('Create a free account there if you have none.', out)
    const login = await run(['login'], work, true)
    if (login.exitCode !== 0) {
      Errors.throwHostEnvironment('Appwrite sign-in did not finish. Retry ./tao connect appwrite after signing in.')
    }
    if (!await appwriteAccount(run, work)) {
      Errors.throwHostEnvironment('Appwrite CLI did not retain a sign-in.')
    }
  }

  HCI.writeLine('Listing Appwrite organizations…', out)
  const organizations = listed(
    await appwriteJson(run, work, ['list-organizations'], 'list Appwrite organizations'),
    ['teams', 'organizations'],
  )
  if (organizations.length === 0) {
    Errors.throwUserInput(
      'This Appwrite account has no organization. Open https://cloud.appwrite.io once to create one, then retry.',
    )
  }
  let organization = organizations[0]!
  if (organizations.length > 1) {
    HCI.writeLine(
      `Appwrite organizations: ${organizations.map(value => `${value['name']} (${value['$id']})`).join(', ')}`,
      out,
    )
    const chosen = (await options.prompts.text(`Appwrite organization ID (Return for ${organization['$id']})`)).trim()
    if (chosen) {
      organization = organizations.find(value => value['$id'] === chosen)
        ?? Errors.throwUserInput('That Appwrite organization ID is not on this account.')
    }
  }
  const organizationId = String(organization['$id'])

  HCI.writeLine('Listing Appwrite projects…', out)
  const projects = listed(
    await appwriteJson(
      run,
      work,
      ['list-projects', '--organization-id', organizationId],
      'list Appwrite projects',
    ),
    ['projects'],
  )
  if (projects.length > 0) {
    HCI.writeLine(`Appwrite projects in this organization: ${projects.map(value => value['$id']).join(', ')}`, out)
  }
  const current = options.currentProjectId?.includes('REPLACE_WITH') ? undefined : options.currentProjectId
  const generated = `tao-hosted-crud-${Platform.randomUUID().replaceAll('-', '').slice(0, 6)}`
  const entered = (await options.prompts.text(
    current
      ? `Appwrite project ID (Return to reuse ${current}, or type another ID)`
      : `Appwrite project ID (Return to create new project ${generated}, or type an existing ID)`,
  )).trim()
  const projectId = entered || current || generated
  if (!/^[a-z0-9][a-z0-9-]{0,35}$/u.test(projectId)) {
    Errors.throwUserInput('Appwrite project ID must be 1–36 lowercase letters, digits, or hyphens.')
  }

  let region: unknown = projects.find(value => value['$id'] === projectId)?.['region']
  const created = region === undefined
  if (created) {
    if (projectId !== generated) {
      const answer = (await options.prompts.text(`Create Appwrite project ${projectId}? Type yes`)).trim()
      if (answer !== 'yes') {
        Errors.throwUserInput('Appwrite project creation was cancelled; no connection was saved.')
      }
    }
    if (projects.length >= 2) {
      HCI.writeLine(
        'The Appwrite Free plan allows 2 projects; creation fails if this organization is at that limit.',
        out,
      )
    }
    const chosenRegion = (await options.prompts.text(
      `Appwrite region (Return for fra, Frankfurt; or ${APPWRITE_REGIONS.slice(1).join(', ')}; permanent)`,
    )).trim() || 'fra'
    if (!(APPWRITE_REGIONS as readonly string[]).includes(chosenRegion)) {
      Errors.throwUserInput(`Choose an Appwrite region: ${APPWRITE_REGIONS.join(', ')}.`)
    }
    HCI.writeLine(`Creating Appwrite project ${projectId} in ${chosenRegion}…`, out)
    const project = await appwriteJson(run, work, [
      'organization',
      'create-project',
      '--organization-id',
      organizationId,
      '--project-id',
      projectId,
      '--name',
      'Tao Hosted CRUD Demo',
      '--region',
      chosenRegion,
    ], `create Appwrite project ${projectId}`)
    region = isObject(project) && typeof project['region'] === 'string' ? project['region'] : chosenRegion
    HCI.writeLine(`Created Appwrite project ${projectId}.`, out)
  }
  const endpoint = typeof region === 'string' && (APPWRITE_REGIONS as readonly string[]).includes(region)
    ? `https://${region}.cloud.appwrite.io/v1`
    : 'https://cloud.appwrite.io/v1'

  HCI.writeLine(
    'Configuring the iPhone platform, email/password auth, and the Notes table with a 15-minute key that is not stored…',
    out,
  )
  for (let attempt = 1;; attempt++) {
    try {
      const key = await appwriteJson(run, work, [
        'organization',
        'create-ephemeral-project-key',
        '--organization-id',
        organizationId,
        '--project-id',
        projectId,
        '--duration',
        String(SETUP_KEY_SECONDS),
        ...SETUP_KEY_SCOPES.flatMap(scope => ['--scopes', scope]),
        '--show-secrets',
      ], 'create a short-lived Appwrite setup key')
      const secret = isObject(key) ? key['secret'] : undefined
      if (typeof secret !== 'string' || secret === '') {
        Errors.throwHostEnvironment('Appwrite CLI did not return the setup key.')
      }
      await provisionAppwrite({ ...options.resources, endpoint, projectId }, secret, options.fetch)
      break
    } catch (error) {
      if (
        !created || attempt === SETUP_ATTEMPTS || !(error instanceof Error) || !/\((401|503)\)/u.test(error.message)
      ) {
        throw error
      }
      HCI.writeLine(
        `Waiting for Appwrite project to finish setup. Retrying in ${
          SETUP_RETRY_MILLISECONDS / 1000
        } seconds (attempt ${attempt + 1} of ${SETUP_ATTEMPTS})…`,
        out,
      )
      await (options.sleep ?? Time.sleep)(SETUP_RETRY_MILLISECONDS)
    }
  }
  HCI.writeLine('Registered the iPhone platform, enabled email/password auth, and created the Notes table.', out)
  return { endpoint, projectId }
}

/** appwriteAccount reads the CLI's signed-in account, or nothing when no one is signed in. */
async function appwriteAccount(run: AppwriteRunner, cwd: string): Promise<Record<string, unknown> | undefined> {
  const result = await run(['whoami', '--raw'], cwd, false)
  if (result.exitCode !== 0) {
    return undefined
  }
  try {
    const account: unknown = JSON.parse(result.stdout)
    return isObject(account) && typeof account['$id'] === 'string' ? account : undefined
  } catch {
    return undefined
  }
}

async function appwriteJson(
  run: AppwriteRunner,
  cwd: string,
  args: readonly string[],
  action: string,
): Promise<unknown> {
  const result = await run([...args, '--raw'], cwd, false)
  if (result.exitCode !== 0) {
    const reported = (result.stderr || result.stdout).replaceAll(/\u001b\[[0-9;]*m/gu, '').replace(
      /^\s*✗\s*Error:\s*/u,
      '',
    )
      .trim()
    Errors.throwHostEnvironment(
      `Appwrite CLI could not ${action}: ${reported || 'check the Appwrite sign-in and organization.'}`,
    )
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    Errors.throwHostEnvironment(`Appwrite CLI could not ${action}; it returned no JSON result.`)
  }
}

/** listed reads the items of an Appwrite list response, which names its array after the resource. */
function listed(response: unknown, keys: readonly string[]): Record<string, unknown>[] {
  const items = isObject(response) ? keys.map(key => response[key]).find(Array.isArray) : undefined
  if (!items) {
    Errors.throwHostEnvironment('Appwrite CLI returned an unexpected list.')
  }
  return items.filter(isObject).filter(value => typeof value['$id'] === 'string')
}

async function runAppwriteCli(args: readonly string[], cwd: string, interactive: boolean): Promise<AppwriteCliResult> {
  const launcher = FS.fileUrlToPath(import.meta.resolve('appwrite-cli/run.js'))
  return await CLI.run('node', { args: [launcher, ...args], cwd, stdio: interactive ? 'inherit' : 'pipe' })
}

/** Configures an existing Appwrite project for Hosted CRUD with a project API key, changing only what is missing. */
export async function provisionAppwrite(
  connection: AppwriteConnection,
  apiKey: string,
  fetchImpl: AppwriteFetch = fetch,
): Promise<void> {
  const request: Request = async (path, method = 'GET', body) => {
    let response: Response
    try {
      response = await fetchImpl(`${connection.endpoint}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': connection.projectId,
          'X-Appwrite-Key': apiKey,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      Errors.throwHostEnvironment(`Could not reach Appwrite at ${connection.endpoint}.`)
    }
    if (response.status === 404 && method === 'GET') {
      return undefined
    }
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? 'Check the project ID, API key, and its scopes.'
        : 'Check the project settings in Appwrite Console.'
      Errors.throwUserInput(`Appwrite ${method} ${path} failed (${response.status}). ${message}`)
    }
    try {
      return await response.json()
    } catch {
      Errors.throwHostEnvironment(`Appwrite ${method} ${path} returned invalid JSON.`)
    }
  }

  const project = asObject(await request('/project'), 'project')
  if (project['$id'] !== connection.projectId) {
    Errors.throwUserInput('The API key belongs to a different Appwrite project.')
  }

  const platforms = asObject(await request('/project/platforms'), 'platform list')['platforms']
  if (!Array.isArray(platforms)) {
    Errors.throwHostEnvironment('Appwrite returned an invalid platform list.')
  }
  const hasApplePlatform = platforms.some(platform =>
    isObject(platform) && platform['type'] === 'apple' && platform['bundleIdentifier'] === connection.platform
  )

  const databasePath = `/tablesdb/${encodeURIComponent(connection.databaseId)}`
  const database = await request(databasePath)
  if (database !== undefined) {
    const existing = asObject(database, 'database')
    if (
      existing['type'] !== 'tablesdb'
      || (existing['specification'] != null && existing['specification'] !== 'serverless')
    ) {
      Errors.throwUserInput(
        'The chosen Appwrite database ID already exists with a different database type or specification.',
      )
    }
  }

  const tablePath = `${databasePath}/tables/${encodeURIComponent(connection.tableId)}`
  let tableExists = false
  if (database !== undefined) {
    const table = await request(tablePath)
    if (table !== undefined) {
      validateTable(asObject(table, 'table'))
      tableExists = true
    }
  }

  if (!hasApplePlatform) {
    await request('/project/platforms/apple', 'POST', {
      platformId: 'tao_hosted_crud_apple',
      name: 'Tao Hosted CRUD iPhone',
      bundleIdentifier: connection.platform,
    })
  }
  const methods = project['authMethods']
  if (
    !Array.isArray(methods)
    || !methods.some(method => isObject(method) && method['$id'] === 'email-password' && method['enabled'] === true)
  ) {
    await request('/project/auth-methods/email-password', 'PATCH', { enabled: true })
  }
  if (database === undefined) {
    await request('/tablesdb', 'POST', {
      databaseId: connection.databaseId,
      name: 'Tao Notes',
      specification: 'serverless',
    })
  }
  if (!tableExists) {
    await request(`${databasePath}/tables`, 'POST', {
      tableId: connection.tableId,
      name: 'Notes',
      rowSecurity: true,
      permissions: ['create("users")'],
      columns: [
        { key: 'ownerId', type: 'varchar', size: 255, required: true },
        { key: 'text', type: 'text', required: true },
        { key: 'done', type: 'boolean', required: true },
        { key: 'updatedAt', type: 'bigint', required: true },
      ],
      indexes: [{ key: 'ownerId', type: 'key', columns: ['ownerId'] }],
    })
  }
}

function validateTable(table: Record<string, unknown>): void {
  if (
    table['rowSecurity'] !== true || !Array.isArray(table['$permissions'])
    || table['$permissions'].length !== 1 || table['$permissions'][0] !== 'create("users")'
  ) {
    Errors.throwUserInput('The existing Notes table must have Row security and only Users Create permission.')
  }
  const columns = table['columns']
  const indexes = table['indexes']
  if (!Array.isArray(columns) || !Array.isArray(indexes)) {
    Errors.throwHostEnvironment('Appwrite returned an invalid Notes table schema.')
  }
  for (const [key, type] of [['ownerId', 'varchar'], ['text', 'text'], ['done', 'boolean'], ['updatedAt', 'bigint']]) {
    if (
      !columns.some(column =>
        isObject(column) && column['key'] === key
        && column['type'] === type && column['required'] === true
        && (key !== 'ownerId' || column['size'] === 255)
      )
    ) {
      Errors.throwUserInput(`The existing Notes table needs the required ${key} column (${type}).`)
    }
  }
  if (
    !indexes.some(index =>
      isObject(index) && index['type'] === 'key'
      && Array.isArray(index['columns']) && index['columns'].length === 1 && index['columns'][0] === 'ownerId'
    )
  ) {
    Errors.throwUserInput('The existing Notes table needs a Key index on ownerId.')
  }
}

function asObject(value: unknown, description: string): Record<string, unknown> {
  if (!isObject(value)) {
    Errors.throwHostEnvironment(`Appwrite returned an invalid ${description}.`)
  }
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
