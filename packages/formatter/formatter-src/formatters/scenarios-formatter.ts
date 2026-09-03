import type { FormatHandlers } from '../formatting'

export default {
  FixtureDeclaration(f) {
    f.oneSpaceAfter('fixture')
  },

  FixtureBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
  },

  FixtureAccountDeclaration(f) {
    f.oneSpaceAfter('account')
  },

  FixtureCreateBinding(f) {
    f.oneSpaceAround('=')
    f.oneSpaceAfter('create', 'for')
    f.oneSpaceBefore('through', 'for')
  },

  FixtureThroughClause(f) {
    f.oneSpaceBefore('through')
    f.oneSpaceAfter('through')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  FixtureArgumentList(f) {
    f.commaSpacedList()
  },

  FixtureArgument(f) {
    f.noSpaceBefore(':')
    f.oneSpaceAfter(':')
  },

  FixtureFieldBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.fields)
    f.lineSeparatedList(f.node.fields)
    f.commaLineList()
  },

  FixtureField(f) {
    f.noSpaceBefore(':')
    f.oneSpaceAfter(':')
  },

  FixtureValueReference() {},

  ScenarioGroupDeclaration(f) {
    f.oneSpaceAfter('scenarios')
    f.oneSpaceBetweenProperties('subject', 'name')
  },

  ScenarioGroupBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
  },

  ScenarioDeclaration(f) {
    f.oneSpaceAfter('scenario')
  },

  ScenarioBlock(f) {
    f.oneSpaceBefore('{')
    const contents = [...f.node.entries, ...f.node.steps]
    f.indentedBraceBlock(contents)
    f.lineSeparatedList(contents)
  },

  ScenarioFixtureClause(f) {
    f.oneSpaceAfter('fixture')
  },

  // The owned block supplies the single space before its opening brace.
  ScenarioPrepareClause() {},

  ScenarioPrepareBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
    f.lineSeparatedList(f.node.statements)
  },

  ScenarioPrepareUpdate(f) {
    f.oneSpaceAfter('update')
  },

  ScenarioRunClause(f) {
    f.oneSpaceAfter('run', 'at')
    f.oneSpaceBefore('at')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  ScenarioRenderClause(f) {
    f.oneSpaceAfter('render')
    if (f.node.view) {
      f.noSpaceBefore('(')
    }
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  ScenarioRenderArgumentList(f) {
    f.commaSpacedList()
  },

  ScenarioRenderArgument(f) {
    f.noSpaceBefore(':')
    f.oneSpaceAfter(':')
  },

  ScenarioDeviceClause(f) {
    f.oneSpaceAfter('device')
    f.oneSpaceAround('x')
    f.oneSpaceBetweenProperties('device', 'width')
  },

  ScenarioAppearanceClause(f) {
    f.oneSpaceAfter('appearance')
  },

  ScenarioLocaleClause(f) {
    f.oneSpaceAfter('locale')
  },

  ScenarioDirectionClause(f) {
    f.oneSpaceAfter('direction')
  },

  ScenarioNetworkClause(f) {
    f.oneSpaceAfter('network')
  },
} satisfies Partial<FormatHandlers>
