import { CLI, Errors, HCI, Json, Platform } from '@shared'
import { prepareSecretBatch } from '../secrets/SecretsCommand'

const steps = [
  {
    instruction:
      'Create or select a dedicated Clerk development application. Keep that application selected throughout setup.',
    url: 'https://dashboard.clerk.com/',
  },
  {
    instruction:
      'Enable email, password and email verification code sign-in. Require no phone number, MFA or session tasks. Save the settings.',
    url: 'https://dashboard.clerk.com/~/user-authentication/user-and-authentication',
  },
  {
    instruction:
      'Select Development and copy the publishable key and secret key. The signing public key will be retrieved automatically.',
    url: 'https://dashboard.clerk.com/~/api-keys',
  },
] as const

const credentialNames = ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_JWT_KEY'] as const

type SetupEnvironment = {
  interactive: () => boolean
  write: (message: string) => void
  waitKey: () => Promise<boolean>
  confirm: (message: string) => Promise<boolean>
  secret: (message: string) => Promise<string>
  open: (url: string) => Promise<boolean>
  fetchJson: (url: string, secret?: string) => Promise<unknown>
  prepare: typeof prepareSecretBatch
}

function liveEnvironment(): SetupEnvironment {
  return {
    interactive: () => HCI.isInteractive(),
    write: message => HCI.writeLine(message),
    waitKey: async () => await HCI.withRawKeys(async read => !['\u0003', '\u001b'].includes(await read())),
    confirm: async message => await HCI.askConfirm({ message, defaultValue: false }),
    secret: async message => (await HCI.askSecret({ message })).value.trim(),
    open: async url => {
      try {
        const command = Platform.hostPlatform === 'darwin' ? 'open' : 'xdg-open'
        if (!['darwin', 'linux'].includes(Platform.hostPlatform)) {
          return false
        }
        return (await CLI.run(command, { args: [url], stdio: 'pipe' })).exitCode === 0
      } catch {
        return false
      }
    },
    fetchJson: async (url, secret) => {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(15_000) as NonNullable<Parameters<typeof fetch>[1]>['signal'],
        ...(secret === undefined ? {} : { headers: { Authorization: `Bearer ${secret}` } }),
      })
      if (!response.ok) {
        Errors.throwHostEnvironment(`Clerk verification returned HTTP ${response.status}.`)
      }
      return await response.json()
    },
    prepare: prepareSecretBatch,
  }
}

/** Repository setup stays interactive and never changes remote authentication settings. */
export async function runSetupClerk(
  options: { instructions?: boolean } = {},
  environment: SetupEnvironment = liveEnvironment(),
): Promise<number> {
  if (options.instructions) {
    for (const step of steps) {
      environment.write(`${step.instruction}\n${step.url}`)
    }
    environment.write(
      'Run `just setup-clerk` in a terminal to validate and encrypt the three Clerk credentials. Then run `just secrets` to materialize them locally.',
    )
    return 0
  }
  if (!environment.interactive()) {
    Errors.throwUserInput(
      'Clerk setup needs an interactive terminal. Use `just setup-clerk --instructions` for the steps.',
    )
  }
  const batch = await environment.prepare()
  const existing = credentialNames.filter(name => batch.existingNames.includes(name))
  if (
    existing.length > 0
    && !await environment.confirm(`Stored Clerk entries exist (${existing.join(', ')}). Replace the Clerk credentials?`)
  ) {
    environment.write('Existing Clerk setup left unchanged; stored values were not decrypted or verified.')
    return 0
  }
  for (const step of steps) {
    environment.write(`${step.instruction}\n${step.url}\nPress any key to open this page, or Escape to cancel.`)
    if (!await environment.waitKey()) {
      return 0
    }
    if (!await environment.open(step.url)) {
      environment.write('Open the URL above manually.')
    }
    if (!await environment.confirm('Have you completed this step?')) {
      return 0
    }
  }
  const publishableKey = await environment.secret('Paste the development publishable key (hidden):')
  const secretKey = await environment.secret('Paste the development secret key (hidden):')
  const decoded = publishableKey.startsWith('pk_test_')
    ? Buffer.from(publishableKey.slice(8), 'base64').toString('utf8')
    : ''
  const host = decoded.endsWith('$') ? decoded.slice(0, -1) : ''
  if (!/^[a-z0-9-]+\.clerk\.accounts\.dev$/.test(host) || !/^sk_test_\S+$/.test(secretKey)) {
    Errors.throwUserInput('Use development instance keys: pk_test_ and sk_test_. Nothing was stored.')
  }
  let jwtKey: string
  try {
    const backend = signingKey(await environment.fetchJson('https://api.clerk.com/v1/jwks', secretKey))
    const frontend = signingKey(await environment.fetchJson(`https://${host}/.well-known/jwks.json`))
    if (backend['n'] !== frontend['n'] || backend['e'] !== frontend['e']) {
      Errors.throwUserInput('The Clerk keys belong to different instances.')
    }
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      backend,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    )
    const base64 = Buffer.from(await crypto.subtle.exportKey('spki', publicKey)).toString('base64')
    jwtKey = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`
  } catch {
    Errors.throwUserInput(
      'Could not verify matching Clerk development keys and one RSA signing key. Check both keys, network access, and signing-key rotation; nothing was stored.',
    )
  }
  if (!await environment.confirm('Save these three verified credentials to the repository encrypted secret store?')) {
    return 0
  }
  await batch.save({ CLERK_PUBLISHABLE_KEY: publishableKey, CLERK_SECRET_KEY: secretKey, CLERK_JWT_KEY: jwtKey })
  environment.write(
    'Encrypted Clerk credentials saved. Run `just secrets` to materialize them locally. Dashboard settings still require the live browser proof.',
  )
  return 0
}

function signingKey(value: unknown) {
  if (!Json.isRecord(value) || !Array.isArray(value['keys']) || value['keys'].length !== 1) {
    Errors.throwUserInput('Expected one Clerk signing key.')
  }
  const key: unknown = value['keys'][0]
  if (
    !Json.isRecord(key) || key['kty'] !== 'RSA' || key['use'] !== 'sig'
    || (key['alg'] !== undefined && key['alg'] !== 'RS256')
    || typeof key['n'] !== 'string' || typeof key['e'] !== 'string'
  ) {
    Errors.throwUserInput('Expected an RSA signature verification key.')
  }
  return { kty: 'RSA', n: key['n'], e: key['e'], alg: 'RS256', ext: true, key_ops: ['verify'] }
}
