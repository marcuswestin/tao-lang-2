/** NativeApiType is the source-neutral value subset this binding proof of concept supports. */
export type NativeApiType =
  | { kind: 'primitive'; name: 'text' | 'number' | 'boolean' }
  | { kind: 'enum'; name: string }
  | { kind: 'record'; name: string }
  | { kind: 'nullable'; value: NativeApiType }
  | { kind: 'callback'; parameters: NativeApiParameter[] }
  | { kind: 'list'; element: NativeApiType }
  | { kind: 'union'; members: NativeApiType[] }

export type NativeApiEnum = {
  name: string
  members: { name: string; value: string | number }[]
  /** Literal unions have no upstream enum object; their constants come from the declaration. */
  literal?: true
}

export type NativeApiParameter = { name: string; type: NativeApiType; optional: boolean }

export type NativeApiRecord = {
  name: string
  fields: NativeApiParameter[]
  /** Verified source-adapter contract, never inferred merely from a method named remove. */
  disposal?: string
}

export type NativeApiOperation = {
  name: string
  parameters: NativeApiParameter[]
  result?: NativeApiType
  asynchronous: boolean
  platforms: string[]
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
  excluded?: string[]
  operations: NativeApiOperation[]
}

export type NativeApiDiagnostic = { symbol: string; reason: string }

export type NativeApiImport = {
  packageName: string
  fromDirectory: string
  exportName?: string
  exclude?: readonly string[]
}

/** NativeApiSource is the extension seam for Expo, React Native, and future metadata readers. */
export interface NativeApiSource {
  readonly name: string
  read(request: NativeApiImport): Promise<{
    catalog: NativeApiCatalog
    diagnostics: NativeApiDiagnostic[]
  }>
}
