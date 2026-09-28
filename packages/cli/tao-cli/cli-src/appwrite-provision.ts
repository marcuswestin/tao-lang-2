import { Errors } from '@shared'

type AppwriteConnection = {
  endpoint: string
  projectId: string
  platform: string
  databaseId: string
  tableId: string
}

type Request = (path: string, method?: string, body?: Record<string, unknown>) => Promise<unknown>
type AppwriteFetch = (url: string, init?: RequestInit) => Promise<Response>

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
