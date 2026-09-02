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
  'action',
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
    if (AST.getDocument(declaration).uri.path !== preludePath(ctx)) {
      ctx.error(preludeValidationMessages.location, declaration)
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
      ctx.error(preludeValidationMessages.missing(expected), file)
    }
  }
  for (const declaration of declarations) {
    if (!expectedNames.has(declaration.name)) {
      ctx.error(preludeValidationMessages.extra(declaration.name), declaration)
    }
    for (const property of declaration.slots?.properties ?? []) {
      if (property.name !== 'implement' && Type.ofProperty(property).kind === 'unresolved') {
        ctx.error(preludeValidationMessages.slotType(property.name), property)
      }
    }
  }
}

function preludePath(ctx: ValidationContext): string {
  return FS.resolvePath('@tao/Prelude.tao', ctx.packagesContext.stdlibRoot)
}
