import { AST, Langium } from '@parser'
import { Validate } from './Validate'
import { createValidationContext, type ValidationRunContext } from './validation'

/** LangiumValidationContextProvider supplies workspace validation state for one file. */
export type LangiumValidationContextProvider = (file: AST.TaoFile) => ValidationRunContext

/** registerTaoValidationChecks registers Tao structural diagnostics with Langium services. */
export function registerTaoValidationChecks(
  services: Langium.LangiumDefaultCoreServices | Langium.LangiumServices,
  contextForFile: LangiumValidationContextProvider,
): void {
  const registry = services.validation.ValidationRegistry
  const checks: Langium.ValidationChecks<AST.TaoLangAstType> = {
    TaoFile: (file, accept) => {
      const ctx = createValidationContext(accept, contextForFile(file))
      Validate.TaoFile(file, ctx)
    },
  }
  registry.register(checks)
}
