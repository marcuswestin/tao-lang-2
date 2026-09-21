import { AST, Langium } from '@parser'
import { Validate } from './Validate'
import { Validation, type ValidationRunContext } from './validation'

/** LangiumValidationContextProvider supplies workspace validation state for one file. */
export type LangiumValidationContextProvider = (file: AST.TaoFile) => ValidationRunContext

/** registerTaoValidationChecks registers Tao diagnostics with Langium services. */
export function registerTaoValidationChecks(
  services: Langium.LangiumDefaultCoreServices | Langium.LangiumServices,
  contextForFile: LangiumValidationContextProvider,
): void {
  const registry = services.validation.ValidationRegistry
  const checks: Langium.ValidationChecks<AST.TaoLangAstType> = {
    // The pass order matches the standalone validator so both paths report the
    // same diagnostics in the same order: structural first, then inferred types.
    TaoFile: async (file, accept) => {
      const ctx = Validation.createContext(accept, contextForFile(file))
      const nodes = Validate.TaoFile(file, ctx)
      Validate.Types(file, nodes, ctx)
      await Validate.ForeignImplementationFiles(file, ctx)
    },
  }
  registry.register(checks)
}
