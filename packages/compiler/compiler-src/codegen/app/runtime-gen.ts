import { AST, Langium } from '@parser'
import { Compile } from '../Compile'

export { Compile } from '../Compile'

export default {
  /** CompileTaoFile compiles a parsed Tao file into Expo-compatible TSX source. */
  CompileTaoFile(taoFile: AST.TaoFile): string {
    return Langium.toString(Compile.TaoFile(taoFile))
  },
} as const
