import { AST, Langium } from '@parser'
import { Compile } from '../Compile'

export { Compile } from '../Compile'

type TaoFileCompileOptions = {
  importLines?: string[]
  scopeBindings?: string[]
  exportedNames?: string[]
  selectedAppName?: string
}

export default {
  /** TaoFile compiles a parsed Tao file into Expo-compatible TSX source. */
  TaoFile(taoFile: AST.TaoFile, opts: TaoFileCompileOptions = {}): string {
    return Langium.toString(Compile.TaoFile(taoFile, opts))
  },
} as const
