import { AST } from '@parser'
import { Assert } from '@shared'

export type StudioDesignValue =
  & Readonly<{ designName: string; end: number; start: number }>
  & (
    | { entries: readonly string[]; kind: 'bundle'; name: string }
    | { kind: 'color'; name: string; value: string }
    | { entries: readonly string[]; kind: 'default'; name: string }
    | { kind: 'screen'; name: string; value: string }
    | { kind: 'size'; name: string; value: string }
    | { entries: readonly string[]; kind: 'style'; name: string }
    | { entries: readonly string[]; kind: 'text'; name: string }
    | { kind: 'token'; name: string; value: string }
  )

/** studioDesignValues inventories every structured design member a parsed Tao file declares, with source identity. */
export function studioDesignValues(file: AST.TaoFile): StudioDesignValue[] {
  const values: StudioDesignValue[] = []
  for (const design of file.statements.filter(AST.isDesignDeclaration)) {
    for (const member of design.block.members) {
      if (AST.isDesignToken(member)) {
        values.push({
          designName: design.name,
          ...studioDesignSource(member),
          kind: 'token',
          name: member.name,
          value: member.value,
        })
      } else if (AST.isDesignBundle(member)) {
        values.push({
          designName: design.name,
          ...studioDesignSource(member),
          entries: member.spec.entries.flatMap(entry => entry.$cstNode?.text ?? []),
          kind: 'bundle',
          name: member.name,
        })
      } else if (AST.isDesignColorsBlock(member)) {
        for (const entry of member.entries) {
          values.push({
            designName: design.name,
            ...studioDesignSource(entry),
            kind: 'color',
            name: entry.name,
            value: entry.value.$cstNode?.text ?? '',
          })
          for (const family of entry.family?.members ?? []) {
            values.push({
              designName: design.name,
              ...studioDesignSource(family),
              kind: 'color',
              name: `${entry.name}.${family.name}`,
              value: family.value.$cstNode?.text ?? '',
            })
          }
        }
      } else if (AST.isDesignSizesBlock(member)) {
        for (const entry of member.entries) {
          values.push({
            designName: design.name,
            ...studioDesignSource(entry),
            kind: 'size',
            name: entry.name,
            value: entry.value.$cstNode?.text ?? '',
          })
        }
      } else if (AST.isDesignTextBlock(member)) {
        for (const entry of member.entries) {
          values.push({
            designName: design.name,
            ...studioDesignSource(entry),
            entries: entry.spec.entries.flatMap(candidate => candidate.$cstNode?.text ?? []),
            kind: 'text',
            name: entry.name,
          })
        }
      } else if (AST.isDesignScreensBlock(member)) {
        for (const entry of member.entries) {
          values.push({
            designName: design.name,
            ...studioDesignSource(entry),
            kind: 'screen',
            name: entry.name,
            value: entry.threshold === undefined ? 'otherwise' : `below ${entry.threshold.$cstNode?.text ?? ''}`,
          })
        }
      } else if (AST.isDesignStylesBlock(member)) {
        for (const entry of member.entries) {
          values.push({
            designName: design.name,
            ...studioDesignSource(entry),
            entries: entry.spec.entries.flatMap(candidate => candidate.$cstNode?.text ?? []),
            kind: /^[A-Z]/.test(entry.name) ? 'default' : 'style',
            name: entry.name,
          })
        }
      }
    }
  }
  return values
}

function studioDesignSource(node: AST.Node): { end: number; start: number } {
  const cst = node.$cstNode
  Assert.input(cst, 'Cannot inspect a structured design value without source coordinates.')
  return { end: cst.end, start: cst.offset }
}
