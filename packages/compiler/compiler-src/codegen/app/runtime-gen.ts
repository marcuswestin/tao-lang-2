import { AST, Langium } from '@parser'
import { Compile } from '../Compile'
import type { InlineInjection } from './injection-plan'

type TaoFileCompileOptions = {
  configurationTypes?: string
  dataEntities?: readonly AST.EntityDataDeclaration[]
  emitDataCatalog?: boolean
  importLines?: string[]
  localDataCatalog?: boolean
  scopeBindings?: string[]
  exportedBindings?: ReadonlyArray<{ exported: string; binding: string }>
  projectRoot?: string
  selectedAppDatasourceConfiguration?: Readonly<Record<string, string>>
  selectedAppName?: string
  studioDataCatalog?: boolean
  studio?: boolean
  debug?: boolean
  studioViews?: ReadonlyArray<{ id: string; view: AST.ViewDeclaration }>
  viewRegistrations?: string
}

export default {
  /** TaoFile compiles a parsed Tao file into Expo-compatible TSX source. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): string {
    return Langium.toString(Compile.TaoFile(taoFile, opts))
  },

  /** InjectionBoundary emits one authored TypeScript block behind a generated module boundary. */
  InjectionBoundary(injection: InlineInjection): string {
    return Langium.toString(Compile.InjectionBoundary(injection))
  },

  /** ConfigurationDeclarations emits the sidecar-facing declaration companion for one Tao file. */
  ConfigurationDeclarations(taoFile: AST.TaoFile, importLines: readonly string[] = []): string {
    return Langium.toString(Compile.ConfigurationDeclarations(taoFile, importLines))
  },

  /** ConfigurationTypes emits sidecar-facing contracts inside one generated runtime module. */
  ConfigurationTypes(taoFile: AST.TaoFile): string {
    return Langium.toString(Compile.ConfigurationTypes(taoFile))
  },

  /** ViewRegistrations emits eager canonical view registrations for restoration and link arrival. */
  ViewRegistrations(taoFile: AST.TaoFile, options: { studio?: boolean } = {}): string {
    return Langium.toString(Compile.ViewRegistrations(taoFile, options))
  },
} as const
