import ASTUtils from '@ast-utils'
import { AST, Langium } from '@parser'
import { defaultStdLibRoot } from '@parser/module-resolution'
import { validateAliases } from './aliases-validator'
import { validateApp } from './app-validator'
import { validateInjections } from './injections-validator'
import { validateInvocations } from './invocations-validator'
import { validateUseStatements } from './use-validator'
import { createLangiumValidationContext } from './validation'
import { validateViews } from './views-validator'

/** registerTaoValidationChecks registers Tao structural diagnostics with Langium services. */
export function registerTaoValidationChecks(
  services: Langium.LangiumDefaultCoreServices | Langium.LangiumServices,
): void {
  const registry = services.validation.ValidationRegistry
  const checks: Langium.ValidationChecks<AST.TaoLangAstType> = {
    TaoFile: (file, accept) => {
      const ctx = createLangiumValidationContext(accept, file)
      validateApp(file, ctx)
      validateViews(file, ctx)
      validateAliases(file, ctx)
      validateInjections(file, ctx)
      validateInvocations(file, ctx)
      const document = ASTUtils.getDocument(file)
      if (document.uri.scheme === 'file') {
        const workspaceFiles = Array.from(services.shared.workspace.LangiumDocuments.all)
          .map(document => document.parseResult.value)
          .filter(AST.isTaoFile)
        validateUseStatements(file, ctx, {
          workspaceFiles,
          filePath: document.uri.path,
          stdLibRoot: defaultStdLibRoot(),
        })
      }
    },
  }
  registry.register(checks)
}
