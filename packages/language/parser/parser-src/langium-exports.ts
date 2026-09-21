import * as langium from 'langium'
import * as langiumGenerate from 'langium/generate'
import * as langiumLsp from 'langium/lsp'
import * as langiumNode from 'langium/node'
import * as vscodeLanguageserver from 'vscode-languageserver/node'

/** Langium exposes the Langium runtime, node, and generator APIs used by Tao packages. */
export const Langium = {
  ...vscodeLanguageserver,
  ...langium,
  ...langiumGenerate,
  ...langiumLsp,
  ...langiumNode,
}

export namespace Langium {
  /** AstNode declares any Langium AST node. */
  export type AstNode = langium.AstNode
  /** CodeAction declares one LSP code action with its workspace edit. */
  export type CodeAction = vscodeLanguageserver.CodeAction
  /** CodeActionParams declares an LSP code action request. */
  export type CodeActionParams = vscodeLanguageserver.CodeActionParams
  /** CodeActionProvider declares the Langium LSP code action service. */
  export type CodeActionProvider = langiumLsp.CodeActionProvider
  /** CstNode declares one Langium concrete-syntax-tree node. */
  export type CstNode = langium.CstNode
  /** DefaultSharedCoreModuleContext declares the host services needed to create Langium shared services. */
  export type DefaultSharedCoreModuleContext = langium.DefaultSharedCoreModuleContext
  /** DefaultSharedModuleContext declares the host services needed to create Langium LSP shared services. */
  export type DefaultSharedModuleContext = langiumLsp.DefaultSharedModuleContext
  /** DocumentFormattingParams declares an LSP document formatting request. */
  export type DocumentFormattingParams = vscodeLanguageserver.DocumentFormattingParams
  /** FindReferencesOptions declares options for finding references. */
  export type FindReferencesOptions = langium.FindReferencesOptions
  /** Formatter declares the Langium LSP document formatting service. */
  export type Formatter = langiumLsp.Formatter
  /** FormattingAction declares one Langium formatting whitespace instruction. */
  export type FormattingAction = langiumLsp.FormattingAction
  /** Generated declares one Langium generator contribution. */
  export type Generated = langiumGenerate.Generated
  /** GeneratorNode declares a structured Langium generator node. */
  export type GeneratorNode = langiumGenerate.GeneratorNode
  /** LangiumCoreServices declares language-specific Langium services. */
  export type LangiumCoreServices = langium.LangiumCoreServices
  /** LangiumDefaultCoreServices declares default language-specific Langium services. */
  export type LangiumDefaultCoreServices = langium.LangiumDefaultCoreServices
  /** LangiumDocument declares a parsed Langium document with an AST root. */
  export type LangiumDocument<T extends AstNode = AstNode> = langium.LangiumDocument<T>
  /** LangiumDocuments declares the workspace document registry service. */
  export type LangiumDocuments = langium.LangiumDocuments
  /** LangiumSharedCoreServices declares Langium services shared by all registered languages. */
  export type LangiumSharedCoreServices = langium.LangiumSharedCoreServices
  /** LangiumServices declares language-specific Langium core and LSP services. */
  export type LangiumServices = langiumLsp.LangiumServices
  /** LangiumSharedServices declares shared Langium core and LSP services. */
  export type LangiumSharedServices = langiumLsp.LangiumSharedServices
  /** NodeFormatter declares the Langium per-node formatting region API. */
  export type NodeFormatter<T extends AstNode> = langiumLsp.NodeFormatter<T>
  /** Position declares one LSP line and character position. */
  export type Position = vscodeLanguageserver.Position
  /** Properties declares the assignable property names of one AST node type. */
  export type Properties<T extends AstNode> = langium.Properties<T>
  /** Reference declares a Langium cross-reference to an AST node. */
  export type Reference<T extends AstNode = AstNode> = langium.Reference<T>
  /** ReferenceDescription declares an indexed reference description. */
  export type ReferenceDescription = langium.ReferenceDescription
  /** ReferenceInfo declares a Langium cross-reference lookup context. */
  export type ReferenceInfo = langium.ReferenceInfo
  /** Scope declares the visible symbols for one Langium cross-reference lookup. */
  export type Scope = langium.Scope
  /** Stream declares a lazy iterable sequence. */
  export type Stream<T> = langium.Stream<T>
  /** TextEdit declares one LSP text replacement. */
  export type TextEdit = vscodeLanguageserver.TextEdit
  /** URI declares a Langium URI value. */
  export type URI = langium.URI
  /** ValidationAcceptor declares a Langium validation diagnostic callback. */
  export type ValidationAcceptor = langium.ValidationAcceptor
  /** ValidationChecks declares Langium validation checks grouped by AST node type. */
  export type ValidationChecks<T> = langium.ValidationChecks<T>
}
