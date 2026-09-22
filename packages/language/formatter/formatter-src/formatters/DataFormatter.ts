import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

// `index`, `order by`, and `local only` state storage facts about the whole entity, so they trail
// the field list as one group with a blank line above it.
function isStorageTail(entry: AST.Node): boolean {
  return AST.isDataIndex(entry) || AST.isDataDefaultOrder(entry) || AST.isDataLocalOnly(entry)
}

/** Entity policies trail storage facts as their own semantic group. */
function entryGroup(entry: AST.Node): 'field' | 'policy' | 'storage' {
  return AST.isEntityCommandPolicy(entry) ? 'policy' : isStorageTail(entry) ? 'storage' : 'field'
}

export const DataFormatter = {
  EntityDataDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('data')
    f.oneSpaceAround('/')
  },

  EntityDataDeclarationBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.separateIndentedLines(
      f.node.entries,
      (previous, next) => entryGroup(previous) === entryGroup(next) ? 1 : 2,
    )
  },

  EntityDataField(f) {
    f.oneSpaceBeforeProperty('primitive', 'boolean', 'negativeName')
    f.oneSpaceAround('/')
    f.oneSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.commaSpacedList()
  },

  Trait(f) {
    f.oneSpaceAfter('default', 'relation', 'required', 'touch', 'on')
    // `(reference)` names its target only when the field name is not the entity.
    f.oneSpaceBeforeProperty('referenceName')
  },

  TraitList(f) {
    f.oneSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.commaSpacedList()
  },

  DataIndex(f) {
    f.oneSpaceAfter('index')
  },

  DataDefaultOrder(f) {
    f.oneSpaceAfter('order', 'by')
  },

  DataLocalOnly(f) {
    f.oneSpaceAfter('local')
  },

  EntityCommandPolicy(f) {
    f.oneSpaceAfter('commands', 'hide')
    f.commaSpacedList()
  },

  /** NowExpression is the bare runtime-applied `now` data-default sentinel. */
  NowExpression() {},

  EntityQueryDeclaration(f) {
    f.oneSpaceAfter('query', 'as', 'from')
    f.oneSpaceBefore('as', 'from')
  },

  QueryBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.clauses)
    f.lineSeparatedList(f.node.clauses)
  },

  WhereClause(f) {
    f.oneSpaceAfter('where')
    f.oneSpaceAround('==', '!=', '<', '<=', '>', '>=')
  },

  BooleanWhereClause(f) {
    f.oneSpaceAfter('where', 'is')
  },

  OrderClause(f) {
    f.oneSpaceAfter('order', 'by')
  },

  LimitClause(f) {
    f.oneSpaceAfter('limit')
  },

  CreateStatement(f) {
    f.oneSpaceAfter('create')
  },

  UpdateStatement(f) {
    f.oneSpaceAfter('update')
    f.oneSpaceAround('with')
  },

  DeleteStatement(f) {
    f.oneSpaceAfter('delete')
  },

  DataWriteBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.fields)
    f.lineSeparatedList(f.node.fields)
    f.commaLineList()
  },

  DataWriteField(f) {
    f.oneSpaceAfter(':')
  },
} satisfies Partial<FormatHandlers>
