import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioAddRenderScenarioPatchRequest,
  StudioAppendScenarioStepsPatchRequest,
  StudioInsertCapturedFixturePatchRequest,
  StudioRecordedScenarioStep,
  StudioRetargetScenarioRenderPatchRequest,
  StudioScenarioArgumentValue,
  StudioSetScenarioArgumentsPatchRequest,
} from './studio-contract'
import {
  applySourceEdits,
  formatAndReparse,
  requireExactKeys,
  requireIdentifier,
  requireViewName,
  type SourceEdit,
  taoStringLiteral,
} from './studio-source-text'
import { namedImportEdit } from './studio-use-imports'

export async function appendScenarioSteps(
  document: AST.Document,
  request: StudioAppendScenarioStepsPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireScenarioIdentity(request.scenarioGroupName, request.scenarioName)
  if (!Array.isArray(request.steps) || request.steps.length === 0 || request.steps.length > 100) {
    Errors.throwUserInput('Studio journey recording must contain between 1 and 100 interactions.')
  }
  const groups = document.parseResult.value.statements
    .filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === request.scenarioGroupName)
  const scenarios = groups.flatMap(group => AST.scenarioDeclarations(group))
    .filter(scenario => scenario.name === request.scenarioName)
  if (groups.length !== 1 || scenarios.length !== 1 || scenarios[0]?.block.$cstNode === undefined) {
    Errors.throwUserInput(
      `Studio scenario is not uniquely declared in this source file: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const steps = request.steps.map(recordedScenarioStepSource)
  const source = document.textDocument.getText()
  const offset = scenarios[0].block.$cstNode.end - 1
  return await formatAndReparse(
    document,
    applySourceEdits(source, [{
      end: offset,
      replacement: `\n${steps.join('\n')}\n`,
      start: offset,
    }]),
  )
}

function recordedScenarioStepSource(step: StudioRecordedScenarioStep): string {
  requireExactKeys(
    step,
    step.kind === 'enter' ? ['kind', 'selector', 'target', 'value'] : ['kind', 'selector', 'target'],
    'Recorded scenario step',
  )
  if (step.kind !== 'press' && step.kind !== 'submit' && step.kind !== 'enter') {
    Errors.throwUserInput('Studio journey recording contains an unsupported interaction.')
  }
  if (!['label', 'placeholder', 'tag', 'text'].includes(step.selector) || step.target.trim() === '') {
    Errors.throwUserInput('Studio journey recording contains an invalid semantic target.')
  }
  const target = step.selector === 'tag'
    ? recordedScenarioTag(step.target)
    : `${step.selector} ${taoStringLiteral(step.target)}`
  return step.kind === 'enter'
    ? `enter ${taoStringLiteral(step.value)} into ${target}`
    : `${step.kind} ${target}`
}

function recordedScenarioTag(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    Errors.throwUserInput(`Studio journey recording tag is invalid: ${value}`)
  }
  return `#${value}`
}

function requireScenarioIdentity(group: string, scenario: string): void {
  if (group.trim() === '' || scenario.trim() === '' || /[\x00-\x1f\x7f]/u.test(group + scenario)) {
    Errors.throwUserInput('Studio journey recording scenario identity is invalid.')
  }
}

/**
 * addRenderScenario adds a new entry to a scenario group, with the device size the caller chose and
 * the own fixture, prepare and render clauses of an existing render entry: how a drawn rectangle
 * becomes a render of an existing view.
 */
export async function addRenderScenario(
  document: AST.Document,
  request: StudioAddRenderScenarioPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireRenderScenarioIdentity(request.scenarioGroupName, request.fromScenarioName)
  requireRenderScenarioIdentity(request.scenarioGroupName, request.scenarioName)
  requirePositiveWholeNumber(request.width, 'Studio render scenario width')
  requirePositiveWholeNumber(request.height, 'Studio render scenario height')
  const groups = document.parseResult.value.statements
    .filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === request.scenarioGroupName)
  const fromScenarios = groups.flatMap(group => AST.scenarioDeclarations(group))
    .filter(scenario => scenario.name === request.fromScenarioName)
  const groupBlockNode = groups[0]?.block.$cstNode
  if (groups.length !== 1 || fromScenarios.length !== 1 || groupBlockNode === undefined) {
    Errors.throwUserInput(
      `Studio scenario is not uniquely declared in this source file: ${request.scenarioGroupName} / ${request.fromScenarioName}`,
    )
  }
  const group = groups[0]!
  const fromScenario = fromScenarios[0]!
  if (!AST.isViewDeclaration(AST.scenarioSubjectDeclaration(fromScenario))) {
    Errors.throwUserInput(
      `Studio can only add a render scenario from a focused render scenario: ${request.scenarioGroupName} / ${request.fromScenarioName}`,
    )
  }
  if (AST.scenarioDeclarations(group).some(scenario => scenario.name === request.scenarioName)) {
    Errors.throwUserInput(`Studio scenario already exists: ${request.scenarioGroupName} / ${request.scenarioName}`)
  }
  // The entry's own fixture and prepare clauses travel with its render clause: the render arguments
  // name fixture handles that only the entry's effective fixture brings into scope.
  const copiedClauses = fromScenario.block.entries.filter(entry =>
    AST.isScenarioFixtureClause(entry) || AST.isScenarioPrepareClause(entry) || AST.isScenarioRenderClause(entry)
  )
  const bodyLines = [
    `device phone ${request.width} x ${request.height}`,
    ...copiedClauses.flatMap(clause => clause.$cstNode ? [clause.$cstNode.text] : []),
  ]
  const entrySource = `scenario ${taoStringLiteral(request.scenarioName)} {\n${bodyLines.join('\n')}\n}`
  const source = document.textDocument.getText()
  const offset = groupBlockNode.end - 1
  return await formatAndReparse(
    document,
    applySourceEdits(source, [{ end: offset, replacement: `\n${entrySource}\n`, start: offset }]),
  )
}

function requireRenderScenarioIdentity(group: string, scenario: string): void {
  if (group.trim() === '' || scenario.trim() === '' || /[\x00-\x1f\x7f]/u.test(group + scenario)) {
    Errors.throwUserInput('Studio render scenario identity is invalid.')
  }
}

function requirePositiveWholeNumber(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    Errors.throwUserInput(`${label} must be a positive whole number.`)
  }
}

export async function insertCapturedFixture(
  document: AST.Document,
  request: StudioInsertCapturedFixturePatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireIdentifier(request.fixtureName, 'captured fixture')
  if (
    document.parseResult.value.statements.some(statement =>
      AST.isFixtureDeclaration(statement) && statement.name === request.fixtureName
    )
  ) {
    Errors.throwUserInput(`Tao fixture already exists: ${request.fixtureName}`)
  }
  const entries = [
    ...request.plan.accounts.map(account => {
      requireIdentifier(account.name, 'captured account')
      return `account ${account.name} { ${fixtureFieldsSource(account.fields)} }`
    }),
    ...request.plan.creates.map(create => {
      requireIdentifier(create.name, 'captured row')
      requireIdentifier(create.entity, 'captured entity')
      return `${create.name} = create ${create.entity} { ${fixtureFieldsSource(create.fields)} }`
    }),
  ]
  const source = document.textDocument.getText()
  const suffix = source.endsWith('\n') ? '' : '\n'
  return await Formatter.formatCode(
    applySourceEdits(source, [
      ...capturedFixtureImportEdits(document.parseResult.value, request.plan.creates.map(create => create.entity)),
      {
        end: source.length,
        replacement: `${suffix}\nfixture ${request.fixtureName} {\n${entries.join('\n')}\n}\n`,
        start: source.length,
      },
    ]),
  )
}

function capturedFixtureImportEdits(file: AST.TaoFile, entityNames: readonly string[]): SourceEdit[] {
  const visibleNames = new Set(
    AST.visibleFileDeclarations(file, AST.isEntityDataDeclaration, entity => entity.singularName)
      .map(entity => entity.singularName),
  )
  const uses = file.statements.filter(AST.isUseStatement)
  const additions = new Map<AST.UseStatement, Set<string>>()
  for (const name of new Set(entityNames)) {
    if (visibleNames.has(name)) {
      continue
    }
    const matchingUses = uses.filter(use =>
      AST.resolvedImportedDeclarations(use).some(declaration =>
        AST.isEntityDataDeclaration(declaration) && declaration.singularName === name
      )
    )
    const targets = new Set(
      matchingUses.flatMap(use =>
        AST.resolvedImportedDeclarations(use).filter(declaration =>
          AST.isEntityDataDeclaration(declaration) && declaration.singularName === name
        )
      ),
    )
    if (targets.size !== 1) {
      Errors.throwUserInput(`Studio captured entity is not uniquely available in this source file: ${name}`)
    }
    const use = matchingUses[0]!
    if (use.all) {
      continue
    }
    const names = additions.get(use) ?? new Set(use.importedDeclarations.map(reference => reference.$refText))
    names.add(name)
    additions.set(use, names)
  }
  return [...additions].map(([use, names]) => {
    const node = use.$cstNode
    if (node === undefined) {
      Errors.throwUserInput('Studio captured entity import has no editable source range.')
    }
    return {
      end: node.end,
      replacement: `use ${[...names].toSorted().join(', ')}${use.importPath ? ` from ${use.importPath}` : ''}`,
      start: node.offset,
    }
  })
}

function fixtureFieldsSource(fields: Readonly<Record<string, StudioScenarioArgumentValue>>): string {
  return Object.entries(fields).map(([name, value]) => {
    requireIdentifier(name, 'captured field')
    return `${name}: ${scenarioArgumentSource(value)}`
  }).join(', ')
}

/** setScenarioArguments replaces one focused scenario's named arguments and canonicalizes the file. */
export async function setScenarioArguments(
  document: AST.Document,
  request: StudioSetScenarioArgumentsPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  const groups = document.parseResult.value.statements
    .filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === request.scenarioGroupName)
  const scenarios = groups.flatMap(group => AST.scenarioDeclarations(group))
    .filter(scenario => scenario.name === request.scenarioName)
  if (groups.length !== 1 || scenarios.length !== 1) {
    Errors.throwUserInput(
      `Studio scenario is not uniquely declared in this source file: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const scenario = scenarios[0]!
  const subject = AST.scenarioSubjectDeclaration(scenario)
  const ownRender = scenario.block.entries.find(AST.isScenarioRenderClause)
  const ownAppearance = scenario.block.entries.find(AST.isScenarioAppearanceClause)
  if (!AST.isViewDeclaration(subject) || scenario.block.$cstNode === undefined) {
    Errors.throwUserInput(
      `Studio can only promote arguments into a focused render scenario: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const argumentsSource = Object.entries(request.arguments)
    .map(([name, value]) => `${name}: ${scenarioArgumentSource(value)}`)
    .join(', ')
  const source = document.textDocument.getText()
  const renderSource = scenarioRenderSource(scenario, subject, argumentsSource)
  const edits: SourceEdit[] = []
  const additions: string[] = []
  if (ownRender?.$cstNode) {
    edits.push({
      end: ownRender.$cstNode.end,
      replacement: renderSource,
      start: ownRender.$cstNode.offset,
    })
  } else {
    additions.push(renderSource)
  }
  if (request.appearance !== undefined) {
    if (ownAppearance?.$cstNode) {
      edits.push({
        end: ownAppearance.$cstNode.end,
        replacement: `appearance ${request.appearance}`,
        start: ownAppearance.$cstNode.offset,
      })
    } else {
      additions.push(`appearance ${request.appearance}`)
    }
  }
  if (additions.length > 0) {
    const firstStepOffset = scenario.block.steps[0]?.$cstNode?.offset
    const insertionOffset = firstStepOffset ?? scenario.block.$cstNode.end - 1
    edits.push({
      end: insertionOffset,
      replacement: `${firstStepOffset === undefined ? '\n' : ''}${additions.join('\n')}\n`,
      start: insertionOffset,
    })
  }
  const content = applySourceEdits(source, edits)
  return await Formatter.formatCode(content)
}

/** scenarioRenderSource writes a scenario's render clause, eliding the view name when the group already names it. */
export function scenarioRenderSource(
  scenario: AST.ScenarioDeclaration,
  view: AST.ViewDeclaration,
  argumentsSource: string,
): string {
  const ownRender = scenario.block.entries.find(AST.isScenarioRenderClause)
  if (ownRender?.view) {
    return `render ${ownRender.view.$refText}(${argumentsSource})`
  }
  const groupSubject = AST.findOwningScenarioGroup(scenario)?.subject?.ref
  return groupSubject === view
    ? `render (${argumentsSource})`
    : `render ${view.name}(${argumentsSource})`
}

/**
 * retargetScenarioRender repoints one entry's render clause at a different view, keeping the entry's
 * effective render arguments verbatim: how a detached Draw rectangle's entry comes to render its own
 * copy. An entry of a view group with no render clause at all renders the new view with no arguments.
 * When a `use` brought the original view into this file, the new view joins that same statement.
 */
export async function retargetScenarioRender(
  document: AST.Document,
  request: StudioRetargetScenarioRenderPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireViewName(request.view)
  const file = document.parseResult.value
  const groups = file.statements
    .filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === request.scenarioGroupName)
  const scenarios = groups.flatMap(group => AST.scenarioDeclarations(group))
    .filter(scenario => scenario.name === request.scenarioName)
  const scenarioBlockNode = scenarios[0]?.block.$cstNode
  if (groups.length !== 1 || scenarios.length !== 1 || scenarioBlockNode === undefined) {
    Errors.throwUserInput(
      `Studio scenario is not uniquely declared in this source file: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const scenario = scenarios[0]!
  const effectiveClause = AST.effectiveScenarioSubjectClause(scenario)
  const original = AST.scenarioSubjectDeclaration(scenario)
  if (
    !AST.isViewDeclaration(original)
    || !(AST.isScenarioRenderClause(effectiveClause) || effectiveClause === undefined)
  ) {
    Errors.throwUserInput(
      `Studio can only retarget a focused render scenario: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const argumentsSource = effectiveClause?.argumentList?.$cstNode?.text ?? ''
  const renderSource = `render ${request.view}(${argumentsSource})`
  const ownRender = scenario.block.entries.find(AST.isScenarioRenderClause)
  const source = document.textDocument.getText()
  const edits: SourceEdit[] = [
    ownRender?.$cstNode
      ? { end: ownRender.$cstNode.end, replacement: renderSource, start: ownRender.$cstNode.offset }
      : {
        end: scenarioBlockNode.offset + 1,
        replacement: `\n${renderSource}`,
        start: scenarioBlockNode.offset + 1,
      },
  ]
  const nameInFile = file.statements.some(statement =>
    (AST.isDeclaration(statement) && AST.declarationNamespace(statement) === 'value' && statement.name === request.view)
    || (AST.isUseStatement(statement)
      && (AST.resolvedImportedDeclarations(statement).some(declaration =>
        AST.declarationNamespace(declaration) === 'value' && declaration.name === request.view
      ) || statement.importedDeclarations.some(item => item.$refText === request.view && item.ref === undefined)))
  )
  const originalUse = file.statements.filter(AST.isUseStatement)
    .find(use => AST.resolvedImportedDeclarations(use).includes(original))
  const importEdit = originalUse === undefined || nameInFile
    ? undefined
    : namedImportEdit(originalUse, request.view)
  if (importEdit !== undefined) {
    edits.push(importEdit)
  }
  return await Formatter.formatCode(applySourceEdits(source, edits))
}

function scenarioArgumentSource(value: StudioScenarioArgumentValue): string {
  if (typeof value === 'string') {
    return taoStringLiteral(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      Errors.throwUserInput('Studio scenario numbers must be finite.')
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return String(value)
  }
  if (value.kind === 'now') {
    return 'now'
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.handle)) {
    Errors.throwUserInput(`Studio fixture handle is invalid: ${value.handle}`)
  }
  return value.handle
}
