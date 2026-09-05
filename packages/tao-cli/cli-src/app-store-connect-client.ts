import { Errors, Json, Time } from '@shared'

export type AppStoreConnectFetch = (input: string, init?: RequestInit) => Promise<Response>

export type AppStoreConnectClock = {
  now(): number
  sleep(ms: number): Promise<void>
}

export type AppStoreConnectClientOptions = {
  /** Supplies a short-lived App Store Connect JWT. The client never retains or reports it. */
  authorizationToken: () => string | Promise<string>
  baseUrl?: string
  clock?: AppStoreConnectClock
  fetch?: AppStoreConnectFetch
}

type JsonApiResource<Type extends string, Attributes> = {
  attributes: Attributes
  id: string
  type: Type
}

type JsonApiRelationship = {
  data: { id: string; type: string } | readonly { id: string; type: string }[]
}

export type AppStoreBundleId = JsonApiResource<'bundleIds', {
  identifier: string
  name?: string
  platform?: string
  seedId: string
}>

export type AppStoreApp = JsonApiResource<'apps', {
  bundleId: string
  contentRightsDeclaration?: string
  name: string
  primaryLocale: string
  sku: string
}>

export type AppStoreBuild = JsonApiResource<'builds', {
  expired?: boolean
  expirationDate?: string
  iconAssetToken?: unknown
  minOsVersion?: string
  processingState: 'FAILED' | 'INVALID' | 'PROCESSING' | 'VALID'
  uploadedDate?: string
  version: string
}>

export type AppStoreVersion = JsonApiResource<'appStoreVersions', {
  appStoreState?: string
  createdDate?: string
  downloadable?: boolean
  platform: 'IOS'
  versionString: string
}>

export type AppStoreReviewSubmission = JsonApiResource<'reviewSubmissions', {
  platform: 'IOS'
  state?: string
  submitted: boolean
}>

export type BetaGroup = JsonApiResource<'betaGroups', {
  createdDate?: string
  isInternalGroup: boolean
  name: string
  publicLinkEnabled?: boolean
}>

export type BetaTester = JsonApiResource<'betaTesters', {
  email: string
  firstName?: string
  inviteType?: string
  lastName?: string
}>

export type BetaBuildLocalization = JsonApiResource<'betaBuildLocalizations', {
  locale: string
  whatsNew?: string
}>

export type BuildBetaDetail = JsonApiResource<'buildBetaDetails', {
  autoNotifyEnabled: boolean
  externalBuildState?: string
  internalBuildState?: string
}>

export type BetaAppLocalization = JsonApiResource<'betaAppLocalizations', {
  contactEmail?: string
  contactFirstName?: string
  contactLastName?: string
  contactPhone?: string
  demoAccountName?: string
  demoAccountPassword?: string
  demoAccountRequired?: boolean
  description?: string
  feedbackEmail?: string
  locale: string
  marketingUrl?: string
  privacyPolicyUrl?: string
}>

export type BetaAppReviewSubmission = JsonApiResource<'betaAppReviewSubmissions', {
  betaReviewState?: string
  submittedDate?: string
}>

export type AppStoreUser = JsonApiResource<'users', {
  allAppsVisible?: boolean
  firstName?: string
  lastName?: string
  roles?: string[]
  username: string
}>

export type AppStoreUserInvitation = JsonApiResource<'userInvitations', {
  allAppsVisible?: boolean
  email: string
  expirationDate?: string
  firstName: string
  lastName: string
  roles: string[]
}>

export type WaitForBuildOptions = {
  appId: string
  buildNumber: string
  pollIntervalMs?: number
  timeoutMs?: number
}

export type BetaAppLocalizationInput = Omit<BetaAppLocalization['attributes'], 'locale'> & {
  locale?: string
}

const defaultClock: AppStoreConnectClock = {
  now: () => Date.now(),
  sleep: Time.sleep,
}

/** AppStoreConnectClient is the typed, key-agnostic HTTP boundary used by `tao ship`. */
export class AppStoreConnectClient {
  readonly #authorizationToken: AppStoreConnectClientOptions['authorizationToken']
  readonly #baseUrl: URL
  readonly #clock: AppStoreConnectClock
  readonly #fetch: AppStoreConnectFetch

  constructor(options: AppStoreConnectClientOptions) {
    this.#authorizationToken = options.authorizationToken
    this.#baseUrl = new URL(options.baseUrl ?? 'https://api.appstoreconnect.apple.com')
    this.#clock = options.clock ?? defaultClock
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  }

  async bundleIds(identifier?: string): Promise<AppStoreBundleId[]> {
    return await this.#list('/v1/bundleIds', identifier === undefined ? {} : { 'filter[identifier]': identifier })
  }

  async registerBundleId(input: { identifier: string; name: string; platform?: 'IOS' }): Promise<AppStoreBundleId> {
    return await this.#create<AppStoreBundleId>('/v1/bundleIds', {
      attributes: {
        identifier: input.identifier,
        name: input.name,
        platform: input.platform ?? 'IOS',
      },
      type: 'bundleIds',
    })
  }

  /** apps finds the human-created App Store record, optionally by its textual bundle identifier. */
  async apps(bundleIdentifier?: string): Promise<AppStoreApp[]> {
    return await this.#list(
      '/v1/apps',
      bundleIdentifier === undefined ? {} : { 'filter[bundleId]': bundleIdentifier },
    )
  }

  /** teamId derives Apple's Team ID from the App ID prefix exposed as bundleIds.seedId. */
  async teamId(): Promise<string> {
    const bundleIds = await this.bundleIds()
    const teamIds = [...new Set(bundleIds.map(bundleId => bundleId.attributes.seedId).filter(Boolean))]
    if (teamIds.length === 0) {
      Errors.throwHostEnvironment(
        'App Store Connect returned no bundle identifier seedId from which Tao can derive the Apple Team ID.',
      )
    }
    if (teamIds.length > 1) {
      Errors.throwHostEnvironment('App Store Connect returned bundle identifiers with more than one Apple Team ID.')
    }
    return teamIds[0]!
  }

  async builds(appId: string, buildNumber?: string): Promise<AppStoreBuild[]> {
    return await this.#list('/v1/builds', {
      'filter[app]': appId,
      ...(buildNumber === undefined ? {} : { 'filter[version]': buildNumber }),
      limit: '200',
    })
  }

  async waitForProcessedBuild(options: WaitForBuildOptions): Promise<AppStoreBuild> {
    const pollIntervalMs = positiveMilliseconds(options.pollIntervalMs, 15_000, 'build poll interval')
    const timeoutMs = positiveMilliseconds(options.timeoutMs, 30 * 60_000, 'build processing timeout')
    const deadline = this.#clock.now() + timeoutMs

    while (true) {
      const matching = await this.builds(options.appId, options.buildNumber)
      const build = matching.find(candidate => candidate.attributes.version === options.buildNumber)
      if (build !== undefined && build.attributes.processingState === 'VALID') {
        return build
      }
      if (build !== undefined && ['FAILED', 'INVALID'].includes(build.attributes.processingState)) {
        Errors.throwHostEnvironment(
          `Apple finished processing build ${options.buildNumber} with state ${build.attributes.processingState}.`,
        )
      }
      const remainingMs = deadline - this.#clock.now()
      if (remainingMs <= 0) {
        Errors.throwHostEnvironment(
          `Apple did not finish processing build ${options.buildNumber} within ${timeoutMs}ms.`,
        )
      }
      await this.#clock.sleep(Math.min(pollIntervalMs, remainingMs))
    }
  }

  async appStoreVersions(appId: string, versionString?: string): Promise<AppStoreVersion[]> {
    return await this.#list(`/v1/apps/${encodeURIComponent(appId)}/appStoreVersions`, {
      'filter[platform]': 'IOS',
      ...(versionString === undefined ? {} : { 'filter[versionString]': versionString }),
    })
  }

  async ensureAppStoreVersion(appId: string, versionString: string): Promise<AppStoreVersion> {
    const existing = await this.appStoreVersions(appId, versionString)
    if (existing.length > 1) {
      Errors.throwHostEnvironment(`App Store Connect returned more than one iOS version '${versionString}'.`)
    }
    return existing[0] ?? await this.#create<AppStoreVersion>('/v1/appStoreVersions', {
      attributes: { platform: 'IOS', versionString },
      relationships: { app: relationship('apps', appId) },
      type: 'appStoreVersions',
    })
  }

  async attachBuildToVersion(versionId: string, buildId: string): Promise<void> {
    await this.#request(`/v1/appStoreVersions/${encodeURIComponent(versionId)}/relationships/build`, {
      body: JSON.stringify({ data: { id: buildId, type: 'builds' } }),
      method: 'PATCH',
    }, false)
  }

  async submitVersionForReview(appId: string, versionId: string): Promise<AppStoreReviewSubmission> {
    const submission = await this.#create<AppStoreReviewSubmission>('/v1/reviewSubmissions', {
      attributes: { platform: 'IOS' },
      relationships: { app: relationship('apps', appId) },
      type: 'reviewSubmissions',
    })
    await this.#create('/v1/reviewSubmissionItems', {
      relationships: {
        appStoreVersion: relationship('appStoreVersions', versionId),
        reviewSubmission: relationship('reviewSubmissions', submission.id),
      },
      type: 'reviewSubmissionItems',
    })
    return await this.#update<AppStoreReviewSubmission>(`/v1/reviewSubmissions/${encodeURIComponent(submission.id)}`, {
      attributes: { submitted: true },
      id: submission.id,
      type: 'reviewSubmissions',
    })
  }

  async betaGroups(appId: string, name?: string): Promise<BetaGroup[]> {
    return await this.#list('/v1/betaGroups', {
      'filter[app]': appId,
      ...(name === undefined ? {} : { 'filter[name]': name }),
    })
  }

  async ensureBetaGroup(appId: string, name: string, isInternalGroup: boolean): Promise<BetaGroup> {
    const existing = await this.betaGroups(appId, name)
    const matching = existing.find(group => group.attributes.isInternalGroup === isInternalGroup)
    if (matching !== undefined) {
      return matching
    }
    if (existing.length > 0) {
      Errors.throwHostEnvironment(
        `TestFlight group '${name}' exists but is not an ${isInternalGroup ? 'internal' : 'external'} group.`,
      )
    }
    return await this.#create<BetaGroup>('/v1/betaGroups', {
      attributes: { isInternalGroup, name },
      relationships: { app: relationship('apps', appId) },
      type: 'betaGroups',
    })
  }

  async betaTesters(email?: string): Promise<BetaTester[]> {
    return await this.#list('/v1/betaTesters', email === undefined ? {} : { 'filter[email]': email })
  }

  async betaTesterGroups(testerId: string): Promise<BetaGroup[]> {
    return await this.#list(`/v1/betaTesters/${encodeURIComponent(testerId)}/betaGroups`, { limit: '200' })
  }

  async ensureBetaTester(email: string, groupId: string): Promise<BetaTester> {
    const existing = await this.betaTesters(email)
    if (existing.length > 1) {
      Errors.throwHostEnvironment(`App Store Connect returned more than one TestFlight tester for '${email}'.`)
    }
    if (existing[0] !== undefined) {
      const groups = await this.betaTesterGroups(existing[0].id)
      if (groups.some(group => group.id === groupId)) {
        return existing[0]
      }
      await this.addTesterToBetaGroup(groupId, existing[0].id)
      return existing[0]
    }
    return await this.#create<BetaTester>('/v1/betaTesters', {
      attributes: { email },
      relationships: { betaGroups: { data: [{ id: groupId, type: 'betaGroups' }] } },
      type: 'betaTesters',
    })
  }

  async addTesterToBetaGroup(groupId: string, testerId: string): Promise<void> {
    await this.#addRelationships('betaGroups', groupId, 'betaTesters', [{ id: testerId, type: 'betaTesters' }])
  }

  async addBuildToBetaGroup(groupId: string, buildId: string): Promise<void> {
    await this.#addRelationships('betaGroups', groupId, 'builds', [{ id: buildId, type: 'builds' }])
  }

  async enableAutomaticBetaNotifications(buildId: string): Promise<BuildBetaDetail> {
    const detail = await this.#resource<BuildBetaDetail>(
      `/v1/builds/${encodeURIComponent(buildId)}/buildBetaDetail`,
    )
    if (detail.attributes.autoNotifyEnabled) {
      return detail
    }
    return await this.#update<BuildBetaDetail>(`/v1/buildBetaDetails/${encodeURIComponent(detail.id)}`, {
      attributes: { autoNotifyEnabled: true },
      id: detail.id,
      type: 'buildBetaDetails',
    })
  }

  async setWhatToTest(buildId: string, whatsNew: string, locale = 'en-US'): Promise<BetaBuildLocalization> {
    const matching = (await this.#list<BetaBuildLocalization>(
      `/v1/builds/${encodeURIComponent(buildId)}/betaBuildLocalizations`,
      {},
    )).filter(localization => localization.attributes.locale === locale)
    if (matching.length > 1) {
      Errors.throwHostEnvironment(`App Store Connect returned more than one '${locale}' What to Test localization.`)
    }
    const localization = matching[0]
    if (localization !== undefined) {
      return await this.#update<BetaBuildLocalization>(
        `/v1/betaBuildLocalizations/${encodeURIComponent(localization.id)}`,
        { attributes: { whatsNew }, id: localization.id, type: 'betaBuildLocalizations' },
      )
    }
    return await this.#create<BetaBuildLocalization>('/v1/betaBuildLocalizations', {
      attributes: { locale, whatsNew },
      relationships: { build: relationship('builds', buildId) },
      type: 'betaBuildLocalizations',
    })
  }

  async ensureBetaAppLocalization(
    appId: string,
    input: BetaAppLocalizationInput = {},
  ): Promise<BetaAppLocalization> {
    const locale = input.locale ?? 'en-US'
    const matching = (await this.#list<BetaAppLocalization>(
      `/v1/apps/${encodeURIComponent(appId)}/betaAppLocalizations`,
      {},
    )).filter(localization => localization.attributes.locale === locale)
    if (matching.length > 1) {
      Errors.throwHostEnvironment(`App Store Connect returned more than one '${locale}' beta app localization.`)
    }
    if (matching[0] !== undefined) {
      const { locale: _locale, ...attributes } = input
      if (Object.keys(attributes).length === 0) {
        return matching[0]
      }
      return await this.#update<BetaAppLocalization>(
        `/v1/betaAppLocalizations/${encodeURIComponent(matching[0].id)}`,
        { attributes, id: matching[0].id, type: 'betaAppLocalizations' },
      )
    }
    return await this.#create<BetaAppLocalization>('/v1/betaAppLocalizations', {
      attributes: { ...input, locale },
      relationships: { app: relationship('apps', appId) },
      type: 'betaAppLocalizations',
    })
  }

  async betaAppReviewSubmissions(buildId: string): Promise<BetaAppReviewSubmission[]> {
    return await this.#list('/v1/betaAppReviewSubmissions', { 'filter[build]': buildId })
  }

  async submitBuildForBetaReview(buildId: string): Promise<BetaAppReviewSubmission> {
    const existing = await this.betaAppReviewSubmissions(buildId)
    if (existing.length > 0) {
      return existing[0]!
    }
    return await this.#create<BetaAppReviewSubmission>('/v1/betaAppReviewSubmissions', {
      relationships: { build: relationship('builds', buildId) },
      type: 'betaAppReviewSubmissions',
    })
  }

  async users(email?: string): Promise<AppStoreUser[]> {
    return await this.#list('/v1/users', email === undefined ? {} : { 'filter[username]': email })
  }

  async inviteUser(input: {
    allAppsVisible?: boolean
    email: string
    firstName: string
    lastName: string
    roles: readonly string[]
    visibleAppIds?: readonly string[]
  }): Promise<AppStoreUserInvitation> {
    return await this.#create<AppStoreUserInvitation>('/v1/userInvitations', {
      attributes: {
        allAppsVisible: input.allAppsVisible ?? input.visibleAppIds === undefined,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: input.roles,
      },
      ...(input.visibleAppIds === undefined
        ? {}
        : {
          relationships: {
            visibleApps: { data: input.visibleAppIds.map(id => ({ id, type: 'apps' })) },
          },
        }),
      type: 'userInvitations',
    })
  }

  async #addRelationships(
    resourceType: string,
    resourceId: string,
    relationshipType: string,
    data: readonly { id: string; type: string }[],
  ): Promise<void> {
    await this.#request(
      `/v1/${resourceType}/${encodeURIComponent(resourceId)}/relationships/${relationshipType}`,
      { body: JSON.stringify({ data }), method: 'POST' },
      false,
    )
  }

  async #create<Resource>(path: string, data: Record<string, unknown>): Promise<Resource> {
    return await this.#resource<Resource>(path, { body: JSON.stringify({ data }), method: 'POST' })
  }

  async #update<Resource>(path: string, data: Record<string, unknown>): Promise<Resource> {
    return await this.#resource<Resource>(path, { body: JSON.stringify({ data }), method: 'PATCH' })
  }

  async #resource<Resource>(path: string, init?: RequestInit): Promise<Resource> {
    const body = await this.#request(path, init, true)
    if (!Json.isRecord(body) || !Json.isRecord(body['data'])) {
      Errors.throwHostEnvironment('App Store Connect returned an invalid resource response.')
    }
    return body['data'] as Resource
  }

  async #list<Resource>(path: string, query: Readonly<Record<string, string>>): Promise<Resource[]> {
    const resources: Resource[] = []
    let next: string | undefined = requestUrl(this.#baseUrl, path, query).href
    while (next !== undefined) {
      const pageUrl = this.#safeApiUrl(next)
      const body = await this.#request(pageUrl.href, undefined, true)
      if (!Json.isRecord(body) || !Array.isArray(body['data'])) {
        Errors.throwHostEnvironment('App Store Connect returned an invalid list response.')
      }
      resources.push(...body['data'] as Resource[])
      const links = body['links']
      next = Json.isRecord(links) && typeof links['next'] === 'string' ? links['next'] : undefined
    }
    return resources
  }

  async #request(path: string, init: RequestInit | undefined, expectsBody: boolean): Promise<unknown> {
    const url = this.#safeApiUrl(path)
    const method = init?.method ?? 'GET'
    let response: Response
    try {
      response = await this.#fetch(url.href, {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${await this.#authorizationToken()}`,
          ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      })
    } catch (error) {
      Errors.throwHostEnvironment(`App Store Connect request failed: ${method} ${url.pathname}.`, { cause: error })
    }
    const text = await response.text()
    if (!response.ok) {
      Errors.throwHostEnvironment(appStoreConnectFailure(method, url.pathname, response.status, text))
    }
    if (!expectsBody || response.status === 204) {
      return undefined
    }
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      Errors.throwHostEnvironment(
        `App Store Connect returned invalid JSON for ${method} ${url.pathname}.`,
        { cause: error },
      )
    }
  }

  #safeApiUrl(path: string): URL {
    const url = new URL(path, this.#baseUrl)
    if (url.origin !== this.#baseUrl.origin) {
      Errors.throwHostEnvironment('App Store Connect returned a pagination URL outside its API origin.')
    }
    return url
  }
}

function relationship(type: string, id: string): JsonApiRelationship {
  return { data: { id, type } }
}

function requestUrl(baseUrl: URL, path: string, query: Readonly<Record<string, string>>): URL {
  const url = new URL(path, baseUrl)
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value)
  }
  return url
}

function appStoreConnectFailure(method: string, path: string, status: number, body: string): string {
  const parsed = Json.tryParse(body)
  const errors = Json.isRecord(parsed) && Array.isArray(parsed['errors']) ? parsed['errors'] : []
  const messages = errors.flatMap(error => {
    if (!Json.isRecord(error)) {
      return []
    }
    const code = typeof error['code'] === 'string' ? ` ${error['code']}` : ''
    const detail = typeof error['detail'] === 'string'
      ? error['detail']
      : typeof error['title'] === 'string'
      ? error['title']
      : undefined
    return detail === undefined ? [] : [`${code}: ${JSON.stringify(detail)}`]
  })
  const suffix = messages.length > 0 ? messages.join(';') : ` HTTP ${status}`
  return `App Store Connect request failed (${status}) for ${method} ${path}.${suffix}`
}

function positiveMilliseconds(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved <= 0) {
    Errors.throwUserInput(`The ${label} must be a positive number of milliseconds.`)
  }
  return resolved
}
