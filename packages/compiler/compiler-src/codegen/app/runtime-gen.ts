import { AST, Langium } from '@parser'
import { Compile } from '../Compile'

export { Compile } from '../Compile'

export default {
  /** TaoFile compiles a parsed Tao file into Expo-compatible TSX source. */
  TaoFile(taoFile: AST.TaoFile): string {
    return Langium.toString(Compile.TaoFile(taoFile))
  },
} as const
