import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'
import { TypesFormatter } from './TypesFormatter'

/** NumericUnitsFormatter formats directly owned tables and keeps construction precedence intact. */
export const NumericUnitsFormatter = {
  ItemTypeExpression(f) {
    if (f.node.unitBlocks.length === 0) {
      TypesFormatter.ItemTypeExpression(f)
      return
    }
    // Match TypesFormatter's ordered with-body layout while adding the newly owned entry kind.
    const entries = [
      ...f.node.properties,
      ...f.node.keys,
      ...f.node.issues,
      ...f.node.accepts,
      ...f.node.supports,
      ...f.node.implementations,
      ...f.node.unitBlocks,
    ].toSorted((left, right) => (left.$cstNode?.offset ?? 0) - (right.$cstNode?.offset ?? 0))
    f.indentedBraceBlock(entries)
    f.commaLineList()
    f.separateIndentedLines(entries, (_previous, next) => AST.isConfigurationImplementation(next) ? 2 : 1)
  },
  NumericUnitBlock(f) {
    f.oneSpaceAfter('units')
    f.indentedBraceBlock(f.node.units)
    f.commaLineList()
    f.lineSeparatedList(f.node.units)
  },
  NumericUnitDeclaration(f) {
    f.oneSpaceBeforeProperty(f.node.sign ? 'sign' : 'scale')
    f.noSpaceAfter('-')
    f.oneSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },
  NumericUnitConstruction(f) {
    f.oneSpaceBeforeProperty('unit')
  },
} satisfies Partial<FormatHandlers>
