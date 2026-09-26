/** NativeApiType is the source-neutral value subset this binding proof of concept supports. */
export type NativeApiType =
  | { kind: 'primitive'; name: 'text' | 'number' | 'boolean' }
  | { kind: 'enum'; name: string }
  | { kind: 'list'; element: NativeApiType }
  | { kind: 'union'; members: NativeApiType[] }

export type NativeApiEnum = {
  name: string
  members: { name: string; value: string | number }[]
}

export type NativeApiOperation = {
  name: string
  parameters: { name: string; type: NativeApiType; optional: boolean }[]
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
  operations: NativeApiOperation[]
}

export type NativeApiDiagnostic = { symbol: string; reason: string }

export type NativeApiImport = {
  packageName: string
  fromDirectory: string
  exportName?: string
}

/** NativeApiSource is the extension seam for Expo, React Native, and future metadata readers. */
export interface NativeApiSource {
  readonly name: string
  read(request: NativeApiImport): Promise<{
    catalog: NativeApiCatalog
    diagnostics: NativeApiDiagnostic[]
  }>
}
