import { AST, Langium } from '@parser'
import { Compile } from '../Compile'

type TaoFileCompileOptions = {
  configurationTypes?: string
  dataEntities?: readonly AST.EntityDataDeclaration[]
  emitDataCatalog?: boolean
  importLines?: string[]
  scopeBindings?: string[]
  exportedBindings?: ReadonlyArray<{ exported: string; binding: string }>
  selectedAppName?: string
}

export default {
  /** TaoFile compiles a parsed Tao file into Expo-compatible TSX source. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): string {
    return Langium.toString(Compile.TaoFile(taoFile, opts))
  },

  /** ConfigurationDeclarations emits the sidecar-facing declaration companion for one Tao file. */
  ConfigurationDeclarations(taoFile: AST.TaoFile): string {
    return Langium.toString(Compile.ConfigurationDeclarations(taoFile))
  },

  /** ConfigurationTypes emits sidecar-facing contracts inside one generated runtime module. */
  ConfigurationTypes(taoFile: AST.TaoFile): string {
    return Langium.toString(Compile.ConfigurationTypes(taoFile))
  },
} as const
