import { Errors, Json } from '@shared'
import type {
  ExpoUpdateAsset,
  ExpoUpdateManifest,
  ExpoUpdatePlatform,
  TaoPublishedUpdate,
  TaoUpdateHistory,
} from '@update-server/types'

export type TaoUpdateFetch = (input: string, init?: RequestInit) => Promise<Response>

export type { ExpoUpdateAsset, ExpoUpdateManifest, ExpoUpdatePlatform, TaoPublishedUpdate }

export type TaoUpdatePublication = {
  applicationId: string
  assets: readonly ExpoUpdateAsset[]
  channel: string
  dataSchemaFingerprint: string
  extra?: Readonly<Record<string, unknown>>
  launchAsset: ExpoUpdateAsset
  message?: string
  metadata?: Readonly<Record<string, string>>
  runtimeVersion: string
  sourceUpdateId?: string
}

export type TaoUpdateAssetUpload = {
  applicationId: string
  bytes: Uint8Array
  contentType: string
  fileExtension?: string
  /** Base64URL-encoded SHA-256 content hash. */
  hash: string
  key: string
}

export type TaoUpdateClientOptions = {
  /** Supplies server administration authorization without retaining or reporting it. */
  authorizationToken: () => string | Promise<string>
  baseUrl: string
  fetch?: TaoUpdateFetch
}

export type InstalledUpdateContract = {
  dataSchemaFingerprint: string
  platform?: ExpoUpdatePlatform
  runtimeVersion: string
}

/**
 * TaoUpdateClient is the CLI boundary to Tao's own update service. The service stores immutable
 * assets, selects the newest update by channel and runtime version, and serves its manifest using
 * the open Expo Updates v1 protocol.
 */
export class TaoUpdateClient {
  readonly #authorizationToken: TaoUpdateClientOptions['authorizationToken']
  readonly #baseUrl: URL
  readonly #fetch: TaoUpdateFetch

  constructor(options: TaoUpdateClientOptions) {
    this.#authorizationToken = options.authorizationToken
    this.#baseUrl = new URL(options.baseUrl)
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  }

  /** uploadAsset stores content at a hash-addressed URL that the service must keep immutable. */
  async uploadAsset(input: TaoUpdateAssetUpload): Promise<ExpoUpdateAsset> {
    validateAsset({
      contentType: input.contentType,
      fileExtension: input.fileExtension,
      hash: input.hash,
      key: input.key,
      url: 'https://validation.invalid/asset',
    })
    const path = `/v1/apps/${encodeURIComponent(input.applicationId)}/assets/${encodeURIComponent(input.hash)}`
    const value = await this.#authorizedRequest(path, {
      body: input.bytes as unknown as RequestInit['body'],
      headers: {
        'content-type': input.contentType,
        'tao-asset-key': input.key,
        ...(input.fileExtension === undefined ? {} : { 'tao-file-extension': input.fileExtension }),
      },
      method: 'PUT',
    })
    if (!isExpoUpdateAsset(value)) {
      Errors.throwHostEnvironment('The Tao update service returned an invalid uploaded asset response.')
    }
    return value
  }

  async publish(publication: TaoUpdatePublication): Promise<TaoPublishedUpdate> {
    validatePublication(publication)
    const path = channelUpdatesPath(publication.applicationId, publication.channel)
    return await this.#publishedUpdateRequest(path, {
      body: JSON.stringify({
        data: {
          assets: publication.assets,
          dataSchemaFingerprint: publication.dataSchemaFingerprint,
          extra: publication.extra ?? {},
          launchAsset: publication.launchAsset,
          message: publication.message,
          metadata: publication.metadata ?? {},
          runtimeVersion: publication.runtimeVersion,
          sourceUpdateId: publication.sourceUpdateId,
        },
        protocolVersion: 1,
      }),
      method: 'POST',
    })
  }

  async update(applicationId: string, channel: string, updateId: string): Promise<TaoPublishedUpdate> {
    return await this.#publishedUpdateRequest(
      `${channelUpdatesPath(applicationId, channel)}/${encodeURIComponent(updateId)}`,
    )
  }

  /** history returns immutable publications newest first. */
  async history(applicationId: string, channel: string): Promise<readonly TaoPublishedUpdate[]> {
    const value = await this.#authorizedRequest(channelUpdatesPath(applicationId, channel))
    if (!isUpdateHistory(value)) {
      Errors.throwHostEnvironment('The Tao update service returned an invalid publication history response.')
    }
    return value.updates
  }

  /** rollback republishes an earlier bundle as a new update, so creation-time ordering stays monotonic. */
  async rollback(input: {
    applicationId: string
    channel: string
    message?: string
    toUpdateId: string
  }): Promise<TaoPublishedUpdate> {
    const source = await this.update(input.applicationId, input.channel, input.toUpdateId)
    return await this.publish({
      applicationId: input.applicationId,
      assets: source.manifest.assets,
      channel: input.channel,
      dataSchemaFingerprint: source.dataSchemaFingerprint,
      extra: source.manifest.extra,
      launchAsset: source.manifest.launchAsset,
      message: input.message ?? `Rollback to ${source.manifest.id}`,
      metadata: source.manifest.metadata,
      runtimeVersion: source.manifest.runtimeVersion,
      sourceUpdateId: source.manifest.id,
    })
  }

  /**
   * rollbackCompatible walks behind the current publication's immutable source. A rollback of a
   * rollback therefore continues backward instead of toggling to the publication it just replaced.
   */
  async rollbackCompatible(input: {
    applicationId: string
    channel: string
    currentUpdateId: string
    message?: string
    supportedBinaries: readonly InstalledUpdateContract[]
  }): Promise<TaoPublishedUpdate> {
    const history = await this.history(input.applicationId, input.channel)
    const currentIndex = history.findIndex(update => update.manifest.id === input.currentUpdateId)
    if (currentIndex < 0) {
      Errors.throwUserInput(`Current update '${input.currentUpdateId}' is absent from publication history.`)
    }
    const current = history[currentIndex]!
    const anchorId = current.sourceUpdateId ?? current.manifest.id
    const anchorIndex = history.findIndex(update => update.manifest.id === anchorId)
    if (anchorIndex < 0) {
      Errors.throwUserInput(`Rollback source '${anchorId}' is absent from publication history.`)
    }
    const source = history.slice(anchorIndex + 1).find(candidate =>
      updateCompatibilityProblem({
        dataSchemaFingerprint: candidate.dataSchemaFingerprint,
        metadata: candidate.manifest.metadata,
        runtimeVersion: candidate.manifest.runtimeVersion,
      }, input.supportedBinaries) === undefined
    )
    if (source === undefined) {
      Errors.throwUserInput('No earlier publication is compatible with every supported build.')
    }
    return await this.publish({
      applicationId: input.applicationId,
      assets: source.manifest.assets,
      channel: input.channel,
      dataSchemaFingerprint: source.dataSchemaFingerprint,
      extra: source.manifest.extra,
      launchAsset: source.manifest.launchAsset,
      message: input.message ?? `Rollback to ${source.manifest.id}`,
      metadata: source.manifest.metadata,
      runtimeVersion: source.manifest.runtimeVersion,
      sourceUpdateId: source.manifest.id,
    })
  }

  /** fetchManifest exercises the same request contract expo-updates uses on device. */
  async fetchManifest(input: {
    applicationId: string
    channel: string
    platform: ExpoUpdatePlatform
    runtimeVersion: string
  }): Promise<ExpoUpdateManifest | undefined> {
    const url = this.#url(`/v1/apps/${encodeURIComponent(input.applicationId)}/manifest`)
    let response: Response
    try {
      response = await this.#fetch(url.href, { headers: expoUpdateRequestHeaders(input) })
    } catch (error) {
      Errors.throwHostEnvironment(`Tao update manifest request failed: GET ${url.pathname}.`, { cause: error })
    }
    if (response.status === 204) {
      return undefined
    }
    const text = await response.text()
    if (!response.ok) {
      Errors.throwHostEnvironment(updateServiceFailure('GET', url.pathname, response.status, text))
    }
    const manifest = Json.tryParse(text)
    if (!isExpoUpdateManifest(manifest)) {
      Errors.throwHostEnvironment('The Tao update service returned an invalid Expo Updates manifest.')
    }
    if (manifest.runtimeVersion !== input.runtimeVersion) {
      Errors.throwHostEnvironment(
        `The Tao update service returned runtime '${manifest.runtimeVersion}' for '${input.runtimeVersion}'.`,
      )
    }
    return manifest
  }

  async #publishedUpdateRequest(path: string, init?: RequestInit): Promise<TaoPublishedUpdate> {
    const value = await this.#authorizedRequest(path, init)
    if (!isPublishedUpdate(value)) {
      Errors.throwHostEnvironment('The Tao update service returned an invalid publication response.')
    }
    return value
  }

  async #authorizedRequest(path: string, init?: RequestInit): Promise<unknown> {
    const url = this.#url(path)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    headers.set('accept', 'application/json')
    headers.set('authorization', `Bearer ${await this.#authorizationToken()}`)
    if (init?.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    let response: Response
    try {
      response = await this.#fetch(url.href, {
        ...init,
        headers,
      })
    } catch (error) {
      Errors.throwHostEnvironment(`Tao update service request failed: ${method} ${url.pathname}.`, { cause: error })
    }
    const text = await response.text()
    if (!response.ok) {
      Errors.throwHostEnvironment(updateServiceFailure(method, url.pathname, response.status, text))
    }
    return Json.tryParse(text)
  }

  #url(path: string): URL {
    const url = new URL(path, this.#baseUrl)
    if (url.origin !== this.#baseUrl.origin) {
      Errors.throwUnexpected('Expected: a Tao update service URL on the configured origin.')
    }
    return url
  }
}

/** expoUpdateRequestHeaders is the client request half of the Expo Updates v1 wire contract. */
function expoUpdateRequestHeaders(input: {
  channel: string
  platform: ExpoUpdatePlatform
  runtimeVersion: string
}): Record<string, string> {
  return {
    accept: 'application/expo+json, application/json;q=0.9, multipart/mixed;q=0.8',
    'expo-channel-name': input.channel,
    'expo-platform': input.platform,
    'expo-protocol-version': '1',
    'expo-runtime-version': input.runtimeVersion,
  }
}

/** expoUpdateResponseHeaders is the minimum response header set for a JSON manifest response. */
export function expoUpdateResponseHeaders(): Record<string, string> {
  return {
    'cache-control': 'private, max-age=0',
    'content-type': 'application/expo+json',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  }
}

/** assertUpdateCompatibility stops a publication that the installed binary cannot load safely. */
export function assertUpdateCompatibility(
  publication: Pick<TaoUpdatePublication, 'dataSchemaFingerprint' | 'metadata' | 'runtimeVersion'>,
  installed: InstalledUpdateContract | readonly InstalledUpdateContract[],
): void {
  const supported = Array.isArray(installed) ? installed : [installed]
  const problem = updateCompatibilityProblem(publication, supported)
  if (problem === 'runtime') {
    Errors.throwUserInput(
      `This update needs native runtime '${publication.runtimeVersion}', but no supported build has it. `
        + 'Ship a new binary instead.',
    )
  }
  if (problem === 'schema') {
    Errors.throwUserInput(
      'This update changes the Tao data schema: at least one installed build cannot migrate, '
        + 'and compatibility is required for every supported build. Ship a new binary instead.',
    )
  }
}

function updateCompatibilityProblem(
  publication: Pick<TaoUpdatePublication, 'dataSchemaFingerprint' | 'metadata' | 'runtimeVersion'>,
  supported: readonly InstalledUpdateContract[],
): 'runtime' | 'schema' | undefined {
  const platform = publication.metadata?.['platform'] === 'android' ? 'android' : 'ios'
  const platformBinaries = supported.filter(binary => (binary.platform ?? 'ios') === platform)
  if (!platformBinaries.some(binary => binary.runtimeVersion === publication.runtimeVersion)) {
    return 'runtime'
  }
  if (platformBinaries.some(binary => binary.dataSchemaFingerprint !== publication.dataSchemaFingerprint)) {
    return 'schema'
  }
  return undefined
}

function validatePublication(publication: TaoUpdatePublication): void {
  if (publication.applicationId.trim().length === 0 || publication.channel.trim().length === 0) {
    Errors.throwUserInput('An update publication needs an application id and channel.')
  }
  if (publication.runtimeVersion.trim().length === 0 || publication.dataSchemaFingerprint.trim().length === 0) {
    Errors.throwUserInput('An update publication needs runtime and data-schema fingerprints.')
  }
  for (const asset of [publication.launchAsset, ...publication.assets]) {
    validateAsset(asset)
  }
}

function validateAsset(asset: ExpoUpdateAsset): void {
  if (asset.key.trim().length === 0 || asset.contentType.trim().length === 0) {
    Errors.throwUserInput('Every update asset needs a key and content type.')
  }
  let url: URL
  try {
    url = new URL(asset.url)
  } catch {
    Errors.throwUserInput(`Update asset '${asset.key}' must have an absolute HTTPS URL.`)
  }
  if (url.protocol !== 'https:') {
    Errors.throwUserInput(`Update asset '${asset.key}' must have an absolute HTTPS URL.`)
  }
  if (asset.fileExtension !== undefined && !asset.fileExtension.startsWith('.')) {
    Errors.throwUserInput(`Update asset '${asset.key}' file extension must begin with '.'.`)
  }
  if (asset.hash === undefined || !/^[A-Za-z0-9_-]+$/u.test(asset.hash)) {
    Errors.throwUserInput(`Update asset '${asset.key}' needs a base64url SHA-256 hash.`)
  }
}

function channelUpdatesPath(applicationId: string, channel: string): string {
  return `/v1/apps/${encodeURIComponent(applicationId)}/channels/${encodeURIComponent(channel)}/updates`
}

function updateServiceFailure(method: string, path: string, status: number, text: string): string {
  const parsed = Json.tryParse(text)
  const message = Json.isRecord(parsed) && typeof parsed['message'] === 'string'
    ? `: ${JSON.stringify(parsed['message'])}`
    : ''
  return `Tao update service request failed (${status}) for ${method} ${path}${message}.`
}

function isPublishedUpdate(value: unknown): value is TaoPublishedUpdate {
  return Json.isRecord(value)
    && typeof value['applicationId'] === 'string'
    && typeof value['channel'] === 'string'
    && typeof value['dataSchemaFingerprint'] === 'string'
    && isExpoUpdateManifest(value['manifest'])
    && (value['message'] === undefined || typeof value['message'] === 'string')
    && (value['sourceUpdateId'] === undefined || typeof value['sourceUpdateId'] === 'string')
}

function isUpdateHistory(value: unknown): value is TaoUpdateHistory {
  return Json.isRecord(value) && Array.isArray(value['updates']) && value['updates'].every(isPublishedUpdate)
}

function isExpoUpdateManifest(value: unknown): value is ExpoUpdateManifest {
  return Json.isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['createdAt'] === 'string'
    && typeof value['runtimeVersion'] === 'string'
    && isExpoUpdateAsset(value['launchAsset'])
    && Array.isArray(value['assets'])
    && value['assets'].every(isExpoUpdateAsset)
    && isStringRecord(value['metadata'])
    && Json.isRecord(value['extra'])
}

function isExpoUpdateAsset(value: unknown): value is ExpoUpdateAsset {
  return Json.isRecord(value)
    && typeof value['key'] === 'string'
    && typeof value['contentType'] === 'string'
    && typeof value['url'] === 'string'
    && (value['hash'] === undefined || typeof value['hash'] === 'string')
    && (value['fileExtension'] === undefined || typeof value['fileExtension'] === 'string')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Json.isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}
