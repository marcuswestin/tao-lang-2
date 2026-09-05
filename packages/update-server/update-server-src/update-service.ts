import { Errors, Http, Json } from '@shared'
import { createHash, randomUUID } from 'node:crypto'
import { InMemoryUpdateStore, type UpdateStore, UpdateStoreConflictError } from './update-store'
import type {
  ExpoUpdateAsset,
  ExpoUpdateManifest,
  ExpoUpdatePlatform,
  StoredAsset,
  TaoPublishedUpdate,
  TaoUpdatePublicationData,
} from './update-types'

export type UpdateServiceOptions = {
  /** Authorizes one transient bearer token without retaining or reporting it. */
  authorize: (token: string) => boolean | Promise<boolean>
  clock?: () => Date
  createUpdateId?: () => string
  publicBaseUrl: string
  store?: UpdateStore
}

export type UpdateService = {
  handle(request: Request): Promise<Response>
}

class UpdateRequestError extends Errors.UserInputError {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** createUpdateService creates a transport-independent request handler around an injected store. */
export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const baseUrl = validatedPublicBaseUrl(options.publicBaseUrl)
  const clock = options.clock ?? (() => new Date())
  const createUpdateId = options.createUpdateId ?? randomUUID
  const store = options.store ?? new InMemoryUpdateStore()

  return {
    async handle(request: Request): Promise<Response> {
      try {
        return await routeRequest(request, { authorize: options.authorize, baseUrl, clock, createUpdateId, store })
      } catch (error) {
        if (error instanceof UpdateRequestError) {
          return errorResponse(error.status, error.messageForUser)
        }
        if (error instanceof UpdateStoreConflictError) {
          return errorResponse(409, error.messageForUser)
        }
        return errorResponse(500, 'The Tao update service could not complete the request.')
      }
    },
  }
}

type RouteContext = {
  authorize: UpdateServiceOptions['authorize']
  baseUrl: URL
  clock: () => Date
  createUpdateId: () => string
  store: UpdateStore
}

async function routeRequest(request: Request, context: RouteContext): Promise<Response> {
  const url = new URL(request.url)
  const assetUpload = routeParts(url.pathname, /^\/v1\/apps\/([^/]+)\/assets\/([^/]+)$/u)
  if (assetUpload !== undefined) {
    if (request.method !== 'PUT') {
      return methodNotAllowed('PUT')
    }
    await requireAuthorization(request, context.authorize)
    return await uploadAsset(request, context, assetUpload[0]!, assetUpload[1]!)
  }

  const updateById = routeParts(
    url.pathname,
    /^\/v1\/apps\/([^/]+)\/channels\/([^/]+)\/updates\/([^/]+)$/u,
  )
  if (updateById !== undefined) {
    if (request.method !== 'GET') {
      return methodNotAllowed('GET')
    }
    await requireAuthorization(request, context.authorize)
    return await readUpdate(context.store, updateById[0]!, updateById[1]!, updateById[2]!)
  }

  const updates = routeParts(url.pathname, /^\/v1\/apps\/([^/]+)\/channels\/([^/]+)\/updates$/u)
  if (updates !== undefined) {
    await requireAuthorization(request, context.authorize)
    if (request.method === 'POST') {
      return await publishUpdate(request, context, updates[0]!, updates[1]!)
    }
    if (request.method === 'GET') {
      return Http.jsonResponse({
        updates: [...await context.store.history(updates[0]!, updates[1]!)].reverse()
          .map(update => update.publication),
      })
    }
    return methodNotAllowed('GET, POST')
  }

  const manifest = routeParts(url.pathname, /^\/v1\/apps\/([^/]+)\/manifest$/u)
  if (manifest !== undefined) {
    return request.method === 'GET'
      ? await readManifest(request, context.store, manifest[0]!)
      : methodNotAllowed('GET')
  }

  const assetDownload = routeParts(url.pathname, /^\/assets\/([A-Za-z0-9_-]+)(\.[A-Za-z0-9]+)?$/u)
  if (assetDownload !== undefined) {
    return request.method === 'GET'
      ? await readAsset(context.store, assetDownload[0]!, assetDownload[1])
      : methodNotAllowed('GET')
  }

  return errorResponse(404, 'No Tao update service route matches this request.')
}

async function uploadAsset(
  request: Request,
  context: RouteContext,
  applicationId: string,
  hash: string,
): Promise<Response> {
  requireNonempty(applicationId, 'An asset upload needs an application id.')
  if (!/^[A-Za-z0-9_-]+$/u.test(hash)) {
    requestError(400, 'An asset upload needs a base64url SHA-256 hash.')
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  const actualHash = createHash('sha256').update(bytes).digest('base64url')
  if (actualHash !== hash) {
    requestError(400, `Asset content does not match its SHA-256 hash.`)
  }
  const contentType = request.headers.get('content-type')?.trim() ?? ''
  const key = request.headers.get('tao-asset-key')?.trim() ?? ''
  const fileExtension = optionalTrimmedHeader(request.headers, 'tao-file-extension')
  if (contentType.length === 0 || key.length === 0) {
    requestError(400, 'Every update asset needs a key and content type.')
  }
  if (fileExtension !== undefined && !/^\.[A-Za-z0-9]+$/u.test(fileExtension)) {
    requestError(400, `Update asset '${key}' has an invalid file extension.`)
  }
  const path = `/assets/${hash}${fileExtension ?? ''}`
  const asset: StoredAsset = {
    bytes,
    contentType,
    ...(fileExtension === undefined ? {} : { fileExtension }),
    hash,
    key,
    url: new URL(path, context.baseUrl).href,
  }
  const result = await context.store.putAsset(asset)
  return Http.jsonResponse(publicAsset(asset), result === 'created' ? 201 : 200)
}

async function publishUpdate(
  request: Request,
  context: RouteContext,
  applicationId: string,
  channel: string,
): Promise<Response> {
  requireNonempty(applicationId, 'An update publication needs an application id.')
  requireNonempty(channel, 'An update publication needs a channel.')
  const envelope = publicationEnvelope(await requestJson(request))
  const data = envelope.data
  validatePublicationData(data)
  await validatePublicationAssets(context.store, context.baseUrl, data)
  if (data.sourceUpdateId !== undefined) {
    const source = await context.store.update(applicationId, channel, data.sourceUpdateId)
    if (source === undefined) {
      requestError(400, `Rollback source update '${data.sourceUpdateId}' does not exist in this channel.`)
    }
  }
  const platform = publicationPlatform(data.metadata)
  const id = context.createUpdateId()
  requireNonempty(id, 'The update service generated an empty update id.')
  const manifest: ExpoUpdateManifest = {
    assets: data.assets,
    createdAt: context.clock().toISOString(),
    extra: data.extra,
    id,
    launchAsset: data.launchAsset,
    metadata: data.metadata,
    runtimeVersion: data.runtimeVersion,
  }
  const publication: TaoPublishedUpdate = {
    applicationId,
    channel,
    dataSchemaFingerprint: data.dataSchemaFingerprint,
    manifest,
    ...(data.message === undefined ? {} : { message: data.message }),
    ...(data.sourceUpdateId === undefined ? {} : { sourceUpdateId: data.sourceUpdateId }),
  }
  await context.store.putUpdate({ platform, publication })
  return Http.jsonResponse(publication, 201)
}

async function readUpdate(
  store: UpdateStore,
  applicationId: string,
  channel: string,
  updateId: string,
): Promise<Response> {
  const update = await store.update(applicationId, channel, updateId)
  return update === undefined
    ? errorResponse(404, `Update '${updateId}' was not found in this channel.`)
    : Http.jsonResponse(update.publication)
}

async function readManifest(request: Request, store: UpdateStore, applicationId: string): Promise<Response> {
  const protocolVersion = requiredHeader(request.headers, 'expo-protocol-version')
  if (protocolVersion !== '1') {
    requestError(400, `Unsupported Expo Updates protocol version '${protocolVersion}'.`)
  }
  const accept = requiredHeader(request.headers, 'accept')
  if (!accept.includes('application/expo+json')) {
    requestError(406, 'The update manifest request must accept application/expo+json.')
  }
  const channel = requiredHeader(request.headers, 'expo-channel-name')
  const runtimeVersion = requiredHeader(request.headers, 'expo-runtime-version')
  const platform = updatePlatform(requiredHeader(request.headers, 'expo-platform'))
  const history = await store.history(applicationId, channel)
  const update = [...history].reverse().find(candidate =>
    candidate.platform === platform && candidate.publication.manifest.runtimeVersion === runtimeVersion
  )
  if (update === undefined) {
    return new Response(null, {
      headers: {
        'cache-control': 'private, max-age=0',
        'expo-protocol-version': '1',
      },
      status: 204,
    })
  }
  return new Response(JSON.stringify(update.publication.manifest), {
    headers: expoManifestHeaders(),
    status: 200,
  })
}

async function readAsset(store: UpdateStore, hash: string, extension?: string): Promise<Response> {
  const asset = await store.asset(hash)
  if (asset === undefined || extension !== asset.fileExtension) {
    return errorResponse(404, 'Update asset not found.')
  }
  return new Response(asset.bytes, {
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': asset.contentType,
    },
  })
}

async function requireAuthorization(
  request: Request,
  authorize: UpdateServiceOptions['authorize'],
): Promise<void> {
  const value = request.headers.get('authorization')
  const match = /^Bearer (\S+)$/u.exec(value ?? '')
  if (match === null || !await authorize(match[1]!)) {
    throw new UpdateRequestError(401, 'Authorization is required for this update management request.')
  }
}

async function validatePublicationAssets(
  store: UpdateStore,
  baseUrl: URL,
  data: TaoUpdatePublicationData,
): Promise<void> {
  for (const asset of [data.launchAsset, ...data.assets]) {
    const hash = asset.hash!
    const stored = await store.asset(hash)
    if (stored === undefined) {
      requestError(400, `Update asset '${asset.key}' has not been uploaded.`)
    }
    const expectedUrl = new URL(`/assets/${hash}${asset.fileExtension ?? ''}`, baseUrl).href
    if (
      asset.url !== expectedUrl
      || stored.url !== asset.url
      || stored.contentType !== asset.contentType
      || stored.fileExtension !== asset.fileExtension
    ) {
      requestError(400, `Update asset '${asset.key}' does not match its immutable upload.`)
    }
  }
}

function validatePublicationData(data: TaoUpdatePublicationData): void {
  requireNonempty(data.runtimeVersion, 'An update publication needs a runtime fingerprint.')
  requireNonempty(data.dataSchemaFingerprint, 'An update publication needs a data-schema fingerprint.')
  for (const asset of [data.launchAsset, ...data.assets]) {
    if (
      asset.key.trim().length === 0
      || asset.contentType.trim().length === 0
      || asset.hash === undefined
      || !/^[A-Za-z0-9_-]+$/u.test(asset.hash)
    ) {
      requestError(400, 'Every published update asset needs a key, content type, and base64url SHA-256 hash.')
    }
  }
}

function publicationEnvelope(value: unknown): { data: TaoUpdatePublicationData; protocolVersion: 1 } {
  if (!Json.isRecord(value) || value['protocolVersion'] !== 1 || !isPublicationData(value['data'])) {
    requestError(400, 'Expected an Expo Updates protocol 1 publication envelope.')
  }
  return value as { data: TaoUpdatePublicationData; protocolVersion: 1 }
}

function isPublicationData(value: unknown): value is TaoUpdatePublicationData {
  return Json.isRecord(value)
    && Array.isArray(value['assets'])
    && value['assets'].every(isExpoUpdateAsset)
    && typeof value['dataSchemaFingerprint'] === 'string'
    && Json.isRecord(value['extra'])
    && isExpoUpdateAsset(value['launchAsset'])
    && (value['message'] === undefined || typeof value['message'] === 'string')
    && isStringRecord(value['metadata'])
    && typeof value['runtimeVersion'] === 'string'
    && (value['sourceUpdateId'] === undefined || typeof value['sourceUpdateId'] === 'string')
}

function isExpoUpdateAsset(value: unknown): value is ExpoUpdateAsset {
  return Json.isRecord(value)
    && typeof value['contentType'] === 'string'
    && (value['fileExtension'] === undefined || typeof value['fileExtension'] === 'string')
    && (value['hash'] === undefined || typeof value['hash'] === 'string')
    && typeof value['key'] === 'string'
    && typeof value['url'] === 'string'
}

function publicationPlatform(metadata: Readonly<Record<string, string>>): ExpoUpdatePlatform {
  const platform = metadata['platform']
  return platform === undefined ? 'ios' : updatePlatform(platform)
}

function updatePlatform(value: string): ExpoUpdatePlatform {
  if (value !== 'android' && value !== 'ios') {
    requestError(400, `Unsupported update platform '${value}'.`)
  }
  return value
}

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() ?? ''
  if (value.length === 0) {
    requestError(400, `Missing required ${name} header.`)
  }
  return value
}

function optionalTrimmedHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)
  return value === null ? undefined : value.trim()
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json() as unknown
  } catch {
    requestError(400, 'Expected a JSON request body.')
  }
}

function routeParts(pathname: string, pattern: RegExp): string[] | undefined {
  const match = pattern.exec(pathname)
  if (match === null) {
    return undefined
  }
  try {
    return match.slice(1).map(value => decodeURIComponent(value ?? ''))
  } catch {
    requestError(400, 'The update request path contains invalid encoding.')
  }
}

function validatedPublicBaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    Errors.throwUserInput('The Tao update server needs an absolute HTTPS public URL.')
  }
  if (url.protocol !== 'https:') {
    Errors.throwUserInput('The Tao update server needs an absolute HTTPS public URL.')
  }
  return url
}

function publicAsset(asset: StoredAsset): ExpoUpdateAsset {
  return {
    contentType: asset.contentType,
    ...(asset.fileExtension === undefined ? {} : { fileExtension: asset.fileExtension }),
    hash: asset.hash,
    key: asset.key,
    url: asset.url,
  }
}

function expoManifestHeaders(): Record<string, string> {
  return {
    'cache-control': 'private, max-age=0',
    'content-type': 'application/expo+json',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  }
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ message: 'Method not allowed.' }), {
    headers: { allow, 'content-type': 'application/json; charset=utf-8' },
    status: 405,
  })
}

function errorResponse(status: number, message: string): Response {
  return Http.jsonResponse({ message }, status)
}

function requestError(status: number, message: string): never {
  throw new UpdateRequestError(status, message)
}

function requireNonempty(value: string, message: string): void {
  if (value.trim().length === 0) {
    requestError(400, message)
  }
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return Json.isRecord(value) && Object.values(value).every(item => typeof item === 'string')
}

export type {
  ExpoUpdateAsset,
  ExpoUpdateManifest,
  ExpoUpdatePlatform,
  TaoPublishedUpdate,
  TaoUpdatePublicationData,
} from './update-types'
