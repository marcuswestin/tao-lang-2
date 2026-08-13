import type { FormatHandlers } from '../formatting'

export default {
  EntityDataDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'data')
    f.oneSpaceAround('/')
  },

  EntityDataDeclarationBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
  },

  EntityDataField(f) {
    f.oneSpaceBeforeProperty('primitive', 'boolean')
    f.oneSpaceAround('/')
    f.oneSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.commaSpacedList()
  },

  EntityDataFieldModifier(f) {
    f.oneSpaceAfter('default', 'relation')
  },

  DataIndex(f) {
    f.oneSpaceAfter('index')
  },

  DataDefaultOrder(f) {
    f.oneSpaceAfter('order', 'by')
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
    f.oneSpaceAfter('where')
  },

  OrderClause(f) {
    f.oneSpaceAfter('order', 'by')
  },

  CreateStatement(f) {
    f.oneSpaceAfter('create')
  },

  UpdateStatement(f) {
    f.oneSpaceAfter('update')
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

  DataStatusStep(f) {
    f.oneSpaceAfter('data', 'error')
    f.oneSpaceBefore('loading', 'ready', 'error')
  },
} satisfies Partial<FormatHandlers>
