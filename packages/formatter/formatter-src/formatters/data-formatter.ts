import type { FormatHandlers } from '../formatting'

export default {
  /** DataDeclaration formats a schema block with one entity per line. */
  DataDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'data')
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entities)
    f.separateIndentedLines(f.node.entities, () => 2)
  },

  /** EntityDeclaration formats `Collection/Entity { ... }` with one field per line. */
  EntityDeclaration(f) {
    f.noSpaceAfter('/')
    f.noSpaceBefore('/')
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.fields)
    f.lineSeparatedList(f.node.fields)
  },

  /** FieldDeclaration formats a field's type, index marker, and default value. */
  FieldDeclaration(f) {
    f.oneSpaceBeforeProperty('type')
    f.oneSpaceBefore('indexed', 'default')
    f.oneSpaceAfter('default')
  },

  /** NowExpression formats the `now()` field default. */
  NowExpression(f) {
    f.noSpaceAfter('now')
    f.noSpaceAfter('(')
  },

  /** QueryDeclaration formats `query Name = Data.Collection where ... order ...`. */
  QueryDeclaration(f) {
    f.oneSpaceAfter('query', 'where', 'order')
    f.oneSpaceAround('=')
    f.oneSpaceBefore('where', 'order')
  },

  /** QueryOrder formats an order field and its direction. */
  QueryOrder(f) {
    f.oneSpaceBeforeProperty('direction')
  },

  /** CreateStatement formats `create Data.Entity { Field: value, ... }`. */
  CreateStatement(f) {
    f.oneSpaceAfter('create')
    f.oneSpaceBefore('{')
    f.commaSpacedList()
    f.singleLineBraceBlock(f.node)
  },

  /** UpdateStatement formats `update Target { Field: value, ... }`. */
  UpdateStatement(f) {
    f.oneSpaceAfter('update')
    f.oneSpaceBefore('{')
    f.commaSpacedList()
    f.singleLineBraceBlock(f.node)
  },

  /** DeleteStatement formats `delete Target`. */
  DeleteStatement(f) {
    f.oneSpaceAfter('delete')
  },

  /** FieldValue formats one `Field: value` mutation entry. */
  FieldValue(f) {
    f.noSpaceBefore(':')
    f.oneSpaceAfter(':')
  },
} satisfies Partial<FormatHandlers>
