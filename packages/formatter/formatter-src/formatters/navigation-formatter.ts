import type { FormatHandlers } from '../formatting'

export default {
  StackDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'stack')
  },

  NavigationBlock(f) {
    const entries = [f.node.initial, ...f.node.destinations]
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(entries)
    f.lineSeparatedList(entries)
  },

  NavigationInitial(f) {
    f.oneSpaceAfter('initial')
  },

  NavigationDestination(f) {
    f.oneSpaceAfter('destination')
  },

  AppStack(f) {
    f.oneSpaceAfter('stack')
  },

  PresentStatement(f) {
    f.oneSpaceAfter('present')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
    f.oneSpaceBeforeProperty('argumentList')
  },

  BackStatement(f) {
    f.oneSpaceAfter('back')
  },
} satisfies Partial<FormatHandlers>
