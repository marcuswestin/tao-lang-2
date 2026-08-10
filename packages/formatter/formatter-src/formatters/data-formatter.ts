import type { FormatHandlers } from '../formatting'

export default {
  DataDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'data')
    f.oneSpaceBefore('local', 'memory')
  },

  DataBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entities)
    f.lineSeparatedList(f.node.entities)
  },

  DataEntity(f) {
    f.oneSpaceBetweenProperties('collectionName', 'name')
  },

  DataEntityBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.fields)
    f.lineSeparatedList(f.node.fields)
  },

  DataField(f) {
    f.oneSpaceBeforeProperty('primitive', 'relationName')
  },

  QueryDeclaration(f) {
    f.oneSpaceAfter('query', 'as')
    f.oneSpaceBefore('as')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
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

  OrderClause(f) {
    f.oneSpaceAfter('order', 'by')
  },

  CreateStatement(f) {
    f.oneSpaceAfter('create')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
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
  },

  DataWriteField(f) {
    f.oneSpaceBeforeProperty('value')
  },

  DataStatusStep(f) {
    f.oneSpaceAfter('data', 'error')
    f.oneSpaceBefore('loading', 'ready', 'error')
  },
} satisfies Partial<FormatHandlers>
