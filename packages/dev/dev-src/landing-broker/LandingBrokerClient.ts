import { CLI, Errors, FS, LocalSocket } from '@shared'
import {
  LANDING_BROKER_VERSION,
  type LandingBrokerPushRequest,
  type LandingBrokerRequest,
  type LandingBrokerResponse,
  landingBrokerSocketPath,
} from './LandingBrokerProtocol'

export type LandingBrokerInspection = {
  refs: ReadonlyMap<string, string>
}

export type LandingBrokerPush = Omit<LandingBrokerPushRequest, 'operation' | 'repositoryGitDir' | 'version'>

/** inspectLandingRemote reads refs through the installed broker and fetches their objects locally. */
export async function inspectLandingRemote(
  repositoryRoot: string,
  branches: readonly string[],
): Promise<LandingBrokerInspection | undefined> {
  const repositoryGitDir = await gitCommonDir(repositoryRoot)
  const response = await requestBroker({
    branches,
    operation: 'inspect',
    repositoryGitDir,
    version: LANDING_BROKER_VERSION,
  })
  if (response === undefined) {
    return undefined
  }
  if (!response.ok) {
    Errors.throwHostEnvironment(`The landing broker refused the remote query: ${response.error}`)
  }
  if (response.operation !== 'inspect') {
    Errors.throwHostEnvironment('The landing broker returned the wrong response.')
  }
  return { refs: new Map(Object.entries(response.refs)) }
}

/** pushLandingRemote asks the broker for one atomic main/archive/update operation. */
export async function pushLandingRemote(
  repositoryRoot: string,
  push: LandingBrokerPush,
): Promise<LandingBrokerInspection | undefined> {
  const repositoryGitDir = await gitCommonDir(repositoryRoot)
  const response = await requestBroker({
    ...push,
    operation: 'push',
    repositoryGitDir,
    version: LANDING_BROKER_VERSION,
  })
  if (response === undefined) {
    return undefined
  }
  if (!response.ok) {
    Errors.throwHostEnvironment(`The landing broker refused the push: ${response.error}`)
  }
  if (response.operation !== 'push') {
    Errors.throwHostEnvironment('The landing broker returned the wrong response.')
  }
  return { refs: new Map(Object.entries(response.refs)) }
}

/** landingBrokerIsReady checks the installed service without exposing any configuration or credential. */
export async function landingBrokerIsReady(): Promise<boolean> {
  const response = await requestBroker({ operation: 'ping', version: LANDING_BROKER_VERSION })
  return response?.ok === true && response.operation === 'ping'
}

async function requestBroker(request: LandingBrokerRequest): Promise<LandingBrokerResponse | undefined> {
  try {
    return await LocalSocket.request<LandingBrokerResponse>(landingBrokerSocketPath(), request)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ECONNREFUSED') {
      return undefined
    }
    throw error
  }
}

async function gitCommonDir(repositoryRoot: string): Promise<string> {
  const result = await CLI.mustRun('git', {
    args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    cwd: repositoryRoot,
  })
  return await FS.realPath(result.stdout.trim()).catch(() => FS.resolvePath(result.stdout.trim()))
}
