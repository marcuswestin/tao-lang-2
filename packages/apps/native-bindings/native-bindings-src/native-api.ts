/** Source-neutral conversion shapes; recursive object members live in catalog definitions. */
export type NativeApiType =
  | { kind: 'primitive'; name: 'text' | 'number' | 'boolean' }
  | { kind: 'enum'; name: string }
  | { kind: 'record'; name: string }
  | { kind: 'nullable'; value: NativeApiType; absence?: 'undefined' }
  | { kind: 'callback'; parameters: NativeApiParameter[] }
  | { kind: 'listener'; name: string }
  | { kind: 'list'; element: NativeApiType }
  | { kind: 'union'; members: NativeApiType[] }
  | { kind: 'reference'; name: string }
  | { kind: 'dynamic' }
  | { kind: 'bytes' }
  | { kind: 'map'; name: string; value: NativeApiType }
  | { kind: 'absence'; value: 'null' | 'undefined' }

/** Locations refer to locked declaration inputs, never absolute installation paths. */
export type NativeApiProvenance = {
  packageName: string
  declaration: string
  line: number
  column: number
  symbol: string
  signature?: string
  overload?: number
  specialization?: Record<string, string>
}

export type NativeApiReference = {
  name: string
  /** Concrete upstream spelling, qualified with type-only imports where necessary. */
  typescript: string
  provenance: NativeApiProvenance
  base?: string
  protocols?: string[]
  /** Runtime constructors need not exist for returned interfaces such as FileHandle. */
  runtimeConstructor?: { path: string[]; global?: true; inheritedPrototype?: boolean }
  /** Required callable members permit validation of protocols without native constructors. */
  methods: NativeApiMember[]
}

export type NativeApiMember =
  | string
  | { symbol: 'iterator' | 'asyncIterator' | 'dispose' | 'asyncDispose' | 'toStringTag' }

export type NativeApiReceiver =
  | { kind: 'module'; path: string[]; global?: true }
  | { kind: 'reference'; name: string }

export type NativeApiTarget =
  | { kind: 'construct'; path: string[]; global?: true }
  | { kind: 'call'; path: string[]; global?: true }
  | { kind: 'method'; receiver: NativeApiReceiver; member: NativeApiMember }
  | { kind: 'get'; receiver: NativeApiReceiver; member: NativeApiMember }
  | { kind: 'set'; receiver: NativeApiReceiver; member: NativeApiMember }

export type NativeApiArgument =
  | { kind: 'parameter'; index: number; rest?: true }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'export'; path: string[] }

export type NativeApiCoverage = {
  provenance: NativeApiProvenance
  disposition: 'generated' | 'type' | 'react-hook' | 'deprecated' | 'unsupported'
  operations: string[]
  reason?: string
}

export type NativeApiEnum = {
  name: string
  members: { name: string; value: string | number | boolean }[]
  /** Literal unions have no upstream enum object; their constants come from the declaration. */
  literal?: true
}

export type NativeApiParameter = {
  name: string
  type: NativeApiType
  optional: boolean
  /** The catalog retains the list type; invocation expands it into upstream arguments. */
  rest?: true
}

export type NativeApiEventControl = 'preventDefault' | 'stopPropagation' | 'stopImmediatePropagation'

type NativeApiCallbackReturn =
  | { returnContract: 'void' }
  | { returnContract: 'ignored'; returnProvenance: NativeApiProvenance }

/** A stable callback capability supports function and handleEvent object forms. */
export type NativeApiListener = NativeApiCallbackReturn & {
  name: string
  parameters: NativeApiParameter[]
  typescript: string
  provenance: NativeApiProvenance
  event?: { argumentIndex: number; permittedControls: NativeApiEventControl[] }
}

/** Paths begin at a Tao parameter; fields retain native declaration names. */
export type NativeApiCallbackOwnership = {
  parameter: number
  fields: string[]
  lifetime:
    | { kind: 'call' }
    | { kind: 'subscription' }
    | { kind: 'promise' }
    | { kind: 'receiver'; parameter: number }
    | { kind: 'resource'; result: true }
}

type NativeApiEventRegistration = {
  listener: string
  receiverParameter: number
  eventName: { kind: 'parameter'; index: number } | { kind: 'literal'; value: string }
  callbackParameter: number
  optionsParameter?: number
}

export type NativeApiEventBinding =
  | ({ kind: 'register' } & NativeApiEventRegistration)
  | ({ kind: 'remove' } & NativeApiEventRegistration)
  | {
    kind: 'property-get'
    listener: string
    receiverParameter: number
  }
  | {
    kind: 'property-set'
    listener: string
    receiverParameter: number
    callbackParameter: number
  }

export type NativeApiRecord = {
  name: string
  fields: NativeApiParameter[]
  /** Verified source-adapter contract, never inferred merely from a method named remove. */
  disposal?: string
  /** Fixed native arrays map to named Tao fields in declaration order. */
  tuple?: true
}

export type NativeApiOperation = {
  name: string
  parameters: NativeApiParameter[]
  result?: NativeApiType
  asynchronous: boolean
  platforms: string[]
  /** Omitted only by the original module-call sources. New object sources always set this. */
  target?: NativeApiTarget
  provenance?: NativeApiProvenance
  /** Concrete generic specializations may bind a native field without an extra Tao argument. */
  arguments?: NativeApiArgument[]
  /** Verified behavior, never inferred from a void result or an operation's spelling. */
  callbackLifetime?: 'call' | 'subscription'
  /** Reached nested callbacks have individually verified ownership. */
  callbackOwnership?: NativeApiCallbackOwnership[]
  eventBinding?: NativeApiEventBinding
  /** Native promises start without awaiting; the descriptor retains their settled shape. */
  pending?: { name: string; result?: NativeApiType }
  /** Explicit task disposal routes invalidate callbacks attached to the raw receiver. */
  callbackEffect?: { kind: 'cancel-receiver'; parameter: number }
}

/** NativeApiCatalog keeps extracted API shapes separate from the backend that can invoke them. */
export type NativeApiCatalog = {
  source: string
  packageName: string
  packageVersion: string
  declaration: string
  declarationHash: string
  enums: NativeApiEnum[]
  records?: NativeApiRecord[]
  references?: NativeApiReference[]
  listeners?: NativeApiListener[]
  coverage?: NativeApiCoverage[]
  /** Includes reached ambient and transitive declarations, not just the root package. */
  inputs?: { packageName: string; packageVersion: string; declaration: string; hash: string }[]
  excluded?: string[]
  operations: NativeApiOperation[]
}

export type NativeApiDiagnostic = { symbol: string; reason: string }

export type NativeApiImport = {
  packageName: string
  fromDirectory: string
  exportName?: string
  /** Explicit supplemental runtime globals selected from the same declaration program. */
  globalExports?: readonly string[]
  exclude?: readonly string[]
  defer?: readonly { symbol: string; disposition: 'react-hook' | 'deprecated'; reason: string }[]
}

/** Resolution paths are transient build inputs and must never be persisted in the catalog. */
export type NativeApiResolvedInput = {
  packageName: string
  packageVersion: string
  declaration: string
  filePath: string
  packageRoot: string
  hash: string
}

/** Physical navigation paths are emission inputs, never persisted semantic provenance. */
export type NativeApiOriginOptions = {
  taoOriginDirectory?: string
  typescriptOriginDirectory?: string
  /** Map a declaration into an installed or captured payload instead of its source installation. */
  originDeclaration?: (
    provenance: NativeApiProvenance,
    input: NativeApiResolvedInput | undefined,
  ) => string | undefined
}

/** NativeApiSource is the extension seam for Expo, React Native, and future metadata readers. */
export interface NativeApiSource {
  readonly name: string
  read(request: NativeApiImport): Promise<{
    catalog: NativeApiCatalog
    diagnostics: NativeApiDiagnostic[]
    resolvedInputs?: NativeApiResolvedInput[]
  }>
}
