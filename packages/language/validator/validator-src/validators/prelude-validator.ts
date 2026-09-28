import { Type } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const expectedPrimitives = [
  'item',
  'number',
  'text',
  'boolean',
  'list',
  'time',
  'duration',
  'color',
  'action',
  'shortcut',
  'command',
  'design',
  'view',
  'scene',
  'nav',
  'datasource',
  'app',
] as const satisfies readonly AST.PrimitiveType[]

export const preludeValidationMessages = {
  location: 'Primitive declarations are allowed only in the pinned Tao prelude.',
  missing: (name: AST.PrimitiveType) => `Tao prelude is missing primitive '${name}'.`,
  extra: (name: AST.PrimitiveType) => `Tao prelude declares unsupported primitive '${name}'.`,
  slotType: (name: string) => `Primitive supplied slot '${name}' must have a resolvable type.`,
} as const

export const preludeValidationChecks = {
  [AST.PrimitiveDeclaration.$type]: (declaration, ctx) => {
    if (!isPreludeDocument(AST.getDocument(declaration).uri.path, ctx)) {
      ctx.error(declaration, preludeValidationMessages.location)
    }
  },
} satisfies NodeValidationChecks

/** validatePreludeFile checks the parsed pinned contract once as ordinary Tao source. */
export function validatePreludeFile(file: AST.TaoFile, ctx: ValidationContext): void {
  if (AST.getDocument(file).uri.path !== preludePath(ctx)) {
    return
  }
  const declarations = file.statements.filter(AST.isPrimitiveDeclaration)
  const expectedNames = new Set<AST.PrimitiveType>(expectedPrimitives)
  for (const expected of expectedPrimitives) {
    if (!declarations.some(declaration => declaration.name === expected)) {
      ctx.error(file, preludeValidationMessages.missing(expected))
    }
  }
  for (const declaration of declarations) {
    if (!expectedNames.has(declaration.name)) {
      ctx.error(declaration, preludeValidationMessages.extra(declaration.name))
    }
    for (const property of declaration.slots?.properties ?? []) {
      if (property.name !== 'implement' && Type.ofProperty(property).kind === 'unresolved') {
        ctx.error(property, preludeValidationMessages.slotType(property.name))
      }
    }
  }
}

function preludePath(ctx: ValidationContext): string {
  return FS.resolvePath('@tao/Prelude.tao', ctx.packagesContext.stdlibRoot)
}

/**
 * A primitive is allowed in the active stdlib prelude, the checkout that owns that contract, and the
 * copy the IDE extension publishes beside the language server. Those are one contract on disk more
 * than once; an app file is none of them.
 */
const preludeDocumentSuffixes = [
  '/packages/apps/stdlib/@tao/Prelude.tao',
  '/_gen_ide-extension/@tao/Prelude.tao',
] as const

function isPreludeDocument(path: string, ctx: ValidationContext): boolean {
  return path === preludePath(ctx) || preludeDocumentSuffixes.some(suffix => path.endsWith(suffix))
}
