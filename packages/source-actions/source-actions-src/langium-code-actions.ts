import type { AST, Langium } from '@parser'
import { useValidationCodes } from '@validator/use-validator'
import { viewValidationCodes } from '@validator/views-validator'
import SourceActions from './source-actions'

const organizeImportsKind = 'source.organizeImports'
const quickFixKind = 'quickfix'
const organizeQuickFixCodes: readonly string[] = [
  useValidationCodes.duplicateImport,
  useValidationCodes.repeatedImport,
  useValidationCodes.useOutOfSection,
]

/** TaoCodeActionProvider serves Tao source actions and validator-diagnostic quick fixes over LSP. */
export class TaoCodeActionProvider implements Langium.CodeActionProvider {
  /** getCodeActions returns the Tao code actions applicable to the request. */
  async getCodeActions(
    document: Langium.LangiumDocument,
    params: Langium.CodeActionParams,
  ): Promise<Langium.CodeAction[]> {
    const taoDocument = document as AST.Document
    const actions: Langium.CodeAction[] = []
    let organized: string | undefined

    if (kindRequested(params, organizeImportsKind)) {
      organized = await SourceActions.organizeSource(taoDocument)
      if (organized !== undefined) {
        actions.push(action('Tao: Organize Use Statements', organizeImportsKind, taoDocument, organized))
      }
    }
    if (!kindRequested(params, quickFixKind)) {
      return actions
    }

    const organizeDiagnostics = diagnosticsWithCodes(params, organizeQuickFixCodes)
    if (organizeDiagnostics.length > 0) {
      organized ??= await SourceActions.organizeSource(taoDocument)
      if (organized !== undefined) {
        actions.push(action('Tao: Organize Use Statements', quickFixKind, taoDocument, organized, organizeDiagnostics))
      }
    }
    const unusedDiagnostics = diagnosticsWithCodes(params, [useValidationCodes.unusedImport])
    if (unusedDiagnostics.length > 0) {
      const removed = await SourceActions.removeUnusedImports(taoDocument)
      if (removed !== undefined) {
        actions.push(action('Tao: Remove unused imports', quickFixKind, taoDocument, removed, unusedDiagnostics))
      }
    }
    const renderDiagnostics = diagnosticsWithCodes(params, [viewValidationCodes.renderNotLast])
    if (renderDiagnostics.length > 0) {
      const moved = await SourceActions.moveRendersLast(taoDocument)
      if (moved !== undefined) {
        actions.push(action('Tao: Move render to end', quickFixKind, taoDocument, moved, renderDiagnostics))
      }
    }
    return actions
  }
}

function kindRequested(params: Langium.CodeActionParams, kind: string): boolean {
  const only = params.context.only
  return !only || only.some(requested => kind === requested || kind.startsWith(`${requested}.`))
}

function diagnosticsWithCodes(
  params: Langium.CodeActionParams,
  codes: readonly string[],
): Langium.CodeActionParams['context']['diagnostics'] {
  return params.context.diagnostics.filter(diagnostic => codes.includes(String(diagnostic.code)))
}

function action(
  title: string,
  kind: string,
  document: AST.Document,
  newText: string,
  diagnostics?: Langium.CodeActionParams['context']['diagnostics'],
): Langium.CodeAction {
  const textDocument = document.textDocument
  return {
    title,
    kind,
    diagnostics,
    edit: {
      changes: {
        [textDocument.uri]: [{
          range: {
            start: { line: 0, character: 0 },
            end: textDocument.positionAt(textDocument.getText().length),
          },
          newText,
        }],
      },
    },
  }
}
