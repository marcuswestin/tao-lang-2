import * as Errors from './core/Errors'

/** ReleasePhase is stamped into public artifacts by their build. */
export type ReleasePhase = 1 | 2 | 3 | 4 | 5 | 'development'
export type ReleaseProfile = Readonly<{ phase: ReleasePhase }>

declare const TAO_RELEASE_PHASE: ReleasePhase

const catalog = {
  core: {
    phase: 1,
    label: 'Core language and local data',
    prerequisite: 'Web CLI, editor, tutorial, and local starter acceptance',
  },
  'http-data': {
    phase: 2,
    label: 'HTTP and multiple datasources',
    prerequisite: 'Core phase acceptance and typed adapter data checks',
  },
  'ios-simulator': {
    phase: 2,
    label: 'iOS simulator',
    prerequisite: 'Core phase acceptance and simulator host checks',
  },
  'advanced-design': {
    phase: 3,
    label: 'Advanced design',
    prerequisite: 'Phase two acceptance and design family/default checks',
  },
  studio: { phase: 3, label: 'Studio', prerequisite: 'Phase two acceptance and Studio edit/run checks' },
  companion: { phase: 4, label: 'Companion', prerequisite: 'Studio phase acceptance and physical-device checks' },
  cloudkit: {
    phase: 4,
    label: 'CloudKit private sync',
    prerequisite: 'Studio phase acceptance and private iCloud account sync checks',
  },
  ship: {
    phase: 5,
    label: 'TestFlight shipping',
    prerequisite: 'Companion phase acceptance and signed TestFlight delivery checks',
  },
  auth: {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'Authentication, access rules, and account offline data',
  },
  'app-commands': {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'App automation commands',
  },
  android: { phase: 'development', prerequisite: 'A separately approved future release phase', label: 'Android' },
  desktop: {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'Desktop app builds',
  },
  'hosted-data': {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'Hosted datasource providers',
  },
  ota: {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'Over-the-air updates',
  },
  'external-distribution': {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'External distribution',
  },
} as const

for (const entry of Object.values(catalog)) {
  Object.freeze(entry)
}
Object.freeze(catalog)

export type ReleaseCapability = keyof typeof catalog

function profile(phase: ReleasePhase): ReleaseProfile {
  if (phase !== 'development' && ![1, 2, 3, 4, 5].includes(phase)) {
    return Errors.throwUserInput('Unknown Tao release phase.')
  }
  return Object.freeze({ phase })
}

const buildProfile = profile(typeof TAO_RELEASE_PHASE === 'undefined' ? 'development' : TAO_RELEASE_PHASE)

function current(): ReleaseProfile {
  return buildProfile
}

function allows(capability: ReleaseCapability, selected: ReleaseProfile = current()): boolean {
  const introduced = catalog[capability].phase
  return selected.phase === 'development' || (introduced !== 'development' && selected.phase >= introduced)
}

function diagnostic(capability: ReleaseCapability, selected: ReleaseProfile = current()): string {
  const entry = catalog[capability]
  const availability = entry.phase === 'development'
    ? 'It is deferred beyond the public release phases.'
    : `It is available from release phase ${entry.phase}.`
  return `${entry.label} is unavailable in Tao release phase ${selected.phase}. ${availability}`
}

function requireCapability(capability: ReleaseCapability, selected: ReleaseProfile = current()): void {
  if (!allows(capability, selected)) {
    Errors.throwUserInput(diagnostic(capability, selected))
  }
}

const version = 1
const packageRules = [
  [/(?:^|\/)@tao\/auth(?:\/|$)/u, 'auth'],
  [/(?:^|\/)@tao\/data\/providers\/http(?:\/|$)/u, 'http-data'],
  [/(?:^|\/)@tao\/data\/providers\/cloudkit(?:\/|$)/u, 'cloudkit'],
  [/(?:^|\/)@tao\/data\/providers\/reference(?:\/|$)/u, 'auth'],
  [/(?:^|\/)@tao\/data\/providers\/(?!(?:local|memory|dev)(?:\/|$))/u, 'hosted-data'],
] as const
const commands = new Map<string, ReleaseCapability>([
  ['review', 'studio'],
  ['studio', 'studio'],
  ['agents', 'app-commands'],
  ['ship', 'ship'],
])
const targets = new Map<string, ReleaseCapability>([
  ['ios', 'ios-simulator'],
  ['android', 'android'],
  ['desktop', 'desktop'],
])
const syntaxRules = new Map<string, ReleaseCapability>([
  ...['AccessDeclaration', 'AccessRule', 'AccessGrant', 'AccessOperation'].map(name => [name, 'auth'] as const),
  ...[
    'DesignColorFamily',
    'DesignColorFamilyMember',
    'DesignConditionalColor',
    'DesignSizesBlock',
    'DesignSizeEntry',
    'DesignSizeExpression',
    'DesignSizeAtom',
    'DesignDimension',
    'DesignTextBlock',
    'DesignTextEntry',
    'DesignScreensBlock',
    'DesignScreenEntry',
    'DesignValuePath',
    'DesignValuePathSegment',
  ].map(name => [name, 'advanced-design'] as const),
])
const appSlots = new Map<string, ReleaseCapability>([['Auth', 'auth'], ['AgentCommands', 'app-commands']])
const syntaxKeywords = new Map<string, ReleaseCapability>([['Trait:reference', 'http-data']])

/** Browser-safe FNV-1a identity; this invalidates caches and is not a cryptographic signature. */
function policyIdentity(): string {
  const policy = JSON.stringify({
    version,
    catalog,
    packages: packageRules.map(([pattern, capability]) => [pattern.source, capability]),
    commands: [...commands],
    targets: [...targets],
    syntax: [...syntaxRules],
    appSlots: [...appSlots],
    syntaxKeywords: [...syntaxKeywords],
  })
  let hash = 14695981039346656037n
  for (const character of policy) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n)
  }
  return hash.toString(16).padStart(16, '0')
}
const identity = policyIdentity()

/** packageCapability classifies public standard-library package paths, including subpaths. */
function packageCapability(path: string): ReleaseCapability {
  const normalized = path.replaceAll('\\', '/').replace(/\/$/u, '')
  return packageRules.find(([pattern]) => pattern.test(normalized))?.[1] ?? 'core'
}

/** ReleaseCapabilities is the shared eligibility policy for language and product entry points. */
export const ReleaseCapabilities = {
  version,
  catalog,
  profile,
  current,
  allows,
  require: requireCapability,
  diagnostic,
  fingerprint: (selected: ReleaseProfile = current()): string =>
    `tao-release-v${version}:${selected.phase}:${identity}`,
  packageCapability,
  syntaxCapability: (kind: string): ReleaseCapability => syntaxRules.get(kind) ?? 'core',
  keywordCapability: (rule: string, word: string): ReleaseCapability =>
    syntaxKeywords.get(`${rule}:${word}`) ?? syntaxRules.get(rule) ?? 'core',
  appSlotCapability: (name: string): ReleaseCapability => appSlots.get(name) ?? 'core',
  symbolCapability: (path: string, name: string): ReleaseCapability =>
    /(?:^|\/)@tao\/Prelude\.tao$/u.test(path) ? appSlots.get(name) ?? 'core' : packageCapability(path),
  commandCapability: (name: string): ReleaseCapability => commands.get(name) ?? 'core',
  targetCapability: (name: string): ReleaseCapability => targets.get(name) ?? 'core',
} as const
