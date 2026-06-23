import { AST, Langium } from '@parser'
import { type Diagnostic, type DiagnosticSeverity, Switch } from '@shared'

/** validatorDiagnostic creates a validator diagnostic. */
export function validatorDiagnostic(
  severity: Parameters<Langium.ValidationAcceptor>[0],
  message: string,
  node: AST.Node,
  opts: { code?: string } = {},
): Diagnostic {
  return {
    filePath: AST.getDocument(node).uri.path,
    message,
    severity: validatorSeverity(severity),
    source: 'validator',
    code: opts.code,
    nodeType: node.$type,
    range: node.$cstNode?.range,
  }
}

function validatorSeverity(severity: Parameters<Langium.ValidationAcceptor>[0]): DiagnosticSeverity {
  return Switch(severity, {
    error: () => 'error',
    warning: () => 'warning',
    info: () => 'information',
    hint: () => 'hint',
  })
}
