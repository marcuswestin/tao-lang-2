import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioAppendScenarioStepsPatchRequest,
  StudioInsertCapturedFixturePatchRequest,
  StudioRecordedScenarioStep,
  StudioScenarioArgumentValue,
  StudioSetScenarioArgumentsPatchRequest,
} from './studio-contract'
import {
  applySourceEdits,
  formatAndReparse,
  requireExactKeys,
  requireIdentifier,
  type SourceEdit,
  taoStringLiteral,
} from './studio-source-text'

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
  const suffix = document.textDocument.getText().endsWith('\n') ? '' : '\n'
  return await Formatter.formatCode(
    `${document.textDocument.getText()}${suffix}\nfixture ${request.fixtureName} {\n${entries.join('\n')}\n}\n`,
  )
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
