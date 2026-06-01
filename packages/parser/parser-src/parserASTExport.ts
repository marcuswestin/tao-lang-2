import * as LGM from 'langium'
import * as ASTGen from './_gen-tao-parser/ast'
import { TaoLangGeneratedModule, TaoLangGeneratedSharedModule } from './_gen-tao-parser/module'

export * from './_gen-tao-parser/ast'

export type Document = LGM.LangiumDocument<ASTGen.TaoFile>
export type Node = LGM.AstNode
export type ParseDiagnostic = NonNullable<Document['diagnostics']>[number]

export const isNode = LGM.isAstNode

export {
  TaoLangGeneratedModule as GeneratedModule,
  TaoLangGeneratedSharedModule as GeneratedSharedModule,
}

export const Utils = {
  ...LGM.AstUtils,
}
