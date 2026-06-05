import { AST, Langium } from '@parser'
import { validateAliases } from './aliases-validator'
import { validateApp } from './app-validator'
import { validateInvocations } from './invocations-validator'
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
      validateInvocations(file, ctx)
    },
  }
  registry.register(checks)
}
