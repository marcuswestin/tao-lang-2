import type { Diagnostic, DiagnosticRange } from '@shared'

/** Options shared by a one-shot refresh and a disk-backed watch. */
export type ProjectToolingOptions = {
  /** Diagnostic control: retain watches and initial refresh but require explicit refresh requests. */
  automaticRefresh?: boolean
  /** Maintained binding locations for an installed or embedded stdlib. Inspection never generates. */
  nativeBindings?: { stdlibRoot?: string; sourceRoots?: readonly string[] }
  /** The installed TypeScript and ambient packages, when they are outside the project. */
  hostModulesRoot?: string
  /** Additional installed node_modules roots used for host peer imports. */
  hostModuleRoots?: readonly string[]
  /** The runtime's source root, when it is outside project node_modules. */
  runtimeRoot?: string
  /** Called after each completed watch refresh, including a stale refresh. */
  onResult?: (result: ProjectToolingResult) => void
  /** Called for each accepted filesystem or native-inventory change before refresh suppression or debounce. */
  onInputChange?: (change: { path?: string; event: string }) => void
  /** Receives watcher or refresh failures that cannot be returned from a file event. */
  onError?: (error: unknown) => void
}

/** One span in a generated contract and its exact originating Tao span. */
export type ProjectToolingSourceMapping = {
  generatedPath: string
  generatedRange: DiagnosticRange
  sourcePath: string
  sourceRange: DiagnosticRange
}

/** A completed disk refresh; stale results may retain last-good contract paths. */
export type ProjectToolingResult = {
  root: string
  status: 'fresh' | 'stale'
  diagnostics: readonly Diagnostic[]
  contractPaths: readonly string[]
  sourceMappings: readonly ProjectToolingSourceMapping[]
  dependencyRoots: readonly string[]
  /** Native TypeScript config inputs beyond the root tsconfig, including missing extends targets. */
  configInputPaths: readonly string[]
  /** Exact authored sidecar inputs outside this project, including missing relative targets. */
  externalSidecarInputPaths: readonly string[]
  /** Exact Tao ownership markers, including nested and external candidates, watched but not copied. */
  sidecarOwnershipInputPaths: readonly string[]
  /** Maintained declaration and generator inputs, including inventory directories. */
  nativeBindingInputPaths: readonly string[]
  /** Exact native-owned outputs watched independently of ordinary generated output. */
  nativeBindingOutputPaths: readonly string[]
  /** Published files whose bytes changed, including paths removed in this refresh. */
  changedOutputPaths: readonly string[]
  /** Monotonically increasing per-project completed-refresh number. */
  revision: number
}

/** A watch has already completed its initial refresh when it is returned. */
export type ProjectToolingWatch = {
  readonly lastResult: ProjectToolingResult
  requestRefresh(options?: { force?: boolean }): Promise<ProjectToolingResult>
  dispose(): Promise<void>
}

/** The service surface implemented after the compiler contract emitter seam is available. */
export type ProjectToolingService = {
  refresh(root: string, options: ProjectToolingOptions): Promise<ProjectToolingResult>
  watch(root: string, options: ProjectToolingOptions): Promise<ProjectToolingWatch>
}
