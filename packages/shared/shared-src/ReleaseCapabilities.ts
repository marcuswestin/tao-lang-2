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
  visionos: {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'visionOS builds',
  },
  watchos: {
    phase: 'development',
    prerequisite: 'A separately approved future release phase',
    label: 'watchOS builds',
  },
  'native-bindings': {
    phase: 'development',
    prerequisite: 'A pre-MVP availability decision and public acceptance',
    label: 'Native API binding generation',
  },
  'project-secrets': {
    phase: 'development',
    prerequisite: 'A pre-MVP availability decision and public acceptance',
    label: 'Encrypted project secrets',
  },
  // An entry point nobody classified stays out of public builds until it is mapped below.
  unclassified: {
    phase: 'development',
    prerequisite: 'An explicit release classification',
    label: 'An unclassified entry point',
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
// Every CLI command, keyed by its full path, and option is classified explicitly; `release-surface`
// tests fail on a new one, and public builds hide it until it is mapped.
const commands = new Map<string, ReleaseCapability>([
  ...[
    'doctor',
    'resources',
    'bug-report',
    'create',
    'project',
    'run',
    'watch',
    'install',
    'build',
    'clean',
    'check-for-updates',
    'compile',
    'facts',
    'coverage',
    'fmt',
    'fix',
    'check',
    'test',
    'completion',
    'complete',
    'release-profile',
    'project id',
    'completion install',
    'bindings',
    'bindings generate',
  ].map(name => [name, 'core'] as const),
  ['review', 'studio'],
  ['studio', 'studio'],
  ['_preview', 'studio'],
  ['_preview qa', 'studio'],
  ...['agents', 'agents commands', 'agents run', 'agents start', 'agents stop', 'agents ping'].map(name =>
    [name, 'app-commands'] as const
  ),
  ['ship', 'ship'],
  ['bridge', 'native-bindings'],
  ...[
    'secrets',
    'secrets identity',
    'secrets init',
    'secrets grant',
    'secrets set',
    'secrets get',
    'secrets list',
    'secrets remove',
  ]
    .map(name => [name, 'project-secrets'] as const),
  ...[
    'instantdb',
    'instantdb push',
    'connect',
    'jazz',
    'jazz generate',
    'convex',
    'convex generate',
    'pylon',
    'pylon generate',
    'firebase',
    'firebase generate',
    'firebase projects',
    'firebase projects list',
    'firebase projects info',
    'firebase projects create',
    'firebase apps',
    'firebase apps list',
    'firebase apps info',
    'firebase apps config',
    'firebase apps create',
    'firebase data',
    'firebase data reset',
  ]
    .map(name => [name, 'hosted-data'] as const),
])
const targets = new Map<string, ReleaseCapability>([
  ['web', 'core'],
  ['ios', 'ios-simulator'],
  ['android', 'android'],
  ['desktop', 'desktop'],
  ['visionos', 'visionos'],
  ['watchos', 'watchos'],
])
// Keyed by long flag, or by `<command path> <flag>` where one command gives a flag another meaning.
const options = new Map<string, ReleaseCapability>([
  ['create --provider', 'hosted-data'],
  ['create --validation-tools', 'hosted-data'],
  ['connect --manual', 'hosted-data'],
  ['connect --rules', 'hosted-data'],
  ...[
    'firebase projects list --account',
    'firebase projects info --account',
    'firebase projects create --account',
    'firebase apps list --project',
    'firebase apps list --account',
    'firebase apps info --project',
    'firebase apps info --account',
    'firebase apps config --project',
    'firebase apps config --account',
    'firebase apps create --project',
    'firebase apps create --account',
    'firebase data reset --project',
    'firebase data reset --uid',
    'firebase data reset --store',
    'firebase data reset --account',
  ].map(name => [name, 'hosted-data'] as const),
  ...[
    '--app',
    '--json',
    '--task',
    '--register-directory',
    '--purpose',
    '--cleanup-condition',
    '--fingerprint',
    '--source',
    '--export',
    '--exclude',
    '--from',
    '--out',
    '--id',
    '--yes',
    '--ai',
    '--skip-tests',
    '--replace',
    '--output',
    '--compile-only',
    '--args',
    '--dry-run',
    '--force',
    '--against',
    '--patch',
    '--minor',
    '--major',
    '--ignore-git',
    '--no-wait',
    '--notes',
    '--beta',
    '--name',
    '--journey-observations',
    '--pass-with-no-tests',
    '--shared-prepare',
    '--shared-run',
    '--shared-finalize',
    '--watch',
    '--shell',
    '--screenshot',
    '--dest',
    '--scenario',
    '--appearance',
    '--note',
    '--studio',
    '--timeline',
  ].map(name => [name, 'core'] as const),
  ['install --publication', 'core'],
  ['install --default-publication', 'core'],
  ['bindings generate --maintained', 'core'],
  ...['--source', '--export', '--exclude', '--out'].map(flag =>
    [`bindings generate ${flag}`, 'native-bindings'] as const
  ),
  ...[...targets].map(([name, capability]) => [`--${name}`, capability] as const),
  ['--device', 'companion'],
  ['_preview qa --device', 'studio'],
  ['--agents', 'app-commands'],
  ['--update', 'ota'],
  ['--rollback', 'ota'],
])
const syntaxRules = new Map<string, ReleaseCapability>([
  ...[
    'AccessDeclaration',
    'AccessRule',
    'AccessGrant',
    'AccessOperation',
    'ConfigurationIssues',
    'ConfigurationAccepts',
    'ConfigurationAcceptedProof',
  ].map(name => [name, 'auth'] as const),
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
    options: [...options],
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
  /** commandCapability classifies a CLI command by its full space-separated path, so a subcommand never inherits. */
  commandCapability: (path: string): ReleaseCapability => commands.get(path) ?? 'unclassified',
  targetCapability: (name: string): ReleaseCapability => targets.get(name) ?? 'unclassified',
  /** optionCapability classifies a CLI flag, preferring a command-specific meaning. */
  optionCapability: (commandPath: string, long: string): ReleaseCapability =>
    options.get(`${commandPath} ${long}`) ?? options.get(long) ?? 'unclassified',
} as const
