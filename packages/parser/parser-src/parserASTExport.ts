import * as ASTGen from './_gen_tao-parser/ast'
import { TaoLangGeneratedModule, TaoLangGeneratedSharedModule } from './_gen_tao-parser/module'
import { Langium } from './langium-exports'

export * from './_gen_tao-parser/ast'

/** Document declares a Langium document whose root is a Tao file AST. */
export type Document = Langium.LangiumDocument<ASTGen.TaoFile>
/** Node declares any Langium AST node in the Tao parser output. */
export type Node = Langium.AstNode
/** ParseDiagnostic declares a diagnostic produced while parsing a Tao document. */
export type ParseDiagnostic = NonNullable<Document['diagnostics']>[number]

export {
  TaoLangGeneratedModule as GeneratedModule,
  TaoLangGeneratedSharedModule as GeneratedSharedModule,
}
