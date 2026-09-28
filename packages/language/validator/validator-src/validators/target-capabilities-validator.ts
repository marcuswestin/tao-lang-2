import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { Diagnostic } from '@shared'
import { Validation, type ValidationContext, type ValidationRunContext } from '../validation'

/** TargetCapabilities describes the native declarations a backend implements, by resolved identity. */
export type TargetCapabilities = {
  readonly target: string
  readonly bindings: ReadonlyMap<AST.Node, 'StackNav' | 'ScrollView' | 'Col' | 'Text' | 'FormButton'>
}

const targetCapabilitiesValidationMessages = {
  unsupported: (target: string, construct: string) => `${target} does not support ${construct} yet.`,
  checkAfterWrite: (target: string) => `${target} requires every action check to precede its state writes.`,
}

/** TargetCapabilitiesValidator checks only the selected app's native execution boundary. */
export const TargetCapabilitiesValidator = {
  messages: targetCapabilitiesValidationMessages,
  validate,
}

function validate(
  app: AST.AppValueDeclaration,
  profile: TargetCapabilities,
  context: ValidationRunContext,
): readonly Diagnostic[] {
  const collected = Validation.collectDiagnostics()
  const ctx = Validation.createContext(collected.accept, context)
  const unsupported = (node: AST.Node, construct: string) =>
    ctx.error(node, targetCapabilitiesValidationMessages.unsupported(profile.target, construct))
  if (!AST.isAppDeclaration(app) || !app.block || app.value) {
    unsupported(app, 'derived app values')
    return collected.diagnostics
  }
  for (const statement of app.block.statements) {
    if (!AST.isAppProperty(statement) || !['Name', 'Navigator'].includes(statement.name) || statement.patch) {
      unsupported(statement, `app member '${'name' in statement ? statement.name : statement.$type}'`)
      continue
    }
    if (statement.name === 'Name' && statement.value && !AST.isStringLiteral(statement.value)) {
      unsupported(statement, 'computed app names')
    }
  }
  const navigator = app.block.statements.find(statement =>
    AST.isAppProperty(statement) && statement.name === 'Navigator'
  )
  const value = AST.isAppProperty(navigator) ? navigator.value : undefined
  if (!AST.isConfigurationConstructor(value) || profile.bindings.get(value.type.ref!) !== 'StackNav') {
    unsupported(navigator ?? app, 'navigation other than the standard StackNav')
    return collected.diagnostics
  }
  const entries = value.block?.entries ?? []
  const initial = entries.find(entry => entry.name === 'Initial')
  for (const entry of entries) {
    if (entry !== initial) {
      unsupported(entry, 'additional navigator configuration')
    }
  }
  const reference = initial?.value
  const scene = AST.isConfigurationReference(reference) ? reference.target.ref : undefined
  if (!AST.isViewDeclaration(scene) || !scene.scene || !scene.block || AST.parametersOf(scene).length > 0) {
    unsupported(initial ?? value, 'initial content other than a parameterless scene')
    return collected.diagnostics
  }
  validateScene(scene, profile, ctx)
  return collected.diagnostics
}

function validateScene(scene: AST.ViewDeclaration, profile: TargetCapabilities, ctx: ValidationContext): void {
  const unsupported = (node: AST.Node, construct: string) =>
    ctx.error(node, targetCapabilitiesValidationMessages.unsupported(profile.target, construct))
  const members = new Set<AST.Node>(scene.block?.statements ?? [])
  const expression = (value: AST.Expression, references = true): void => {
    if (AST.isNumberLiteral(value) || AST.isStringLiteral(value) || AST.isBooleanLiteral(value)) {
      return
    }
    if (AST.isBinaryExpression(value)) {
      if (!['+', '-', '*', '/', '<', '<=', '>', '>=', '==', '!=', 'and', 'or'].includes(value.operator)) {
        unsupported(value, `operator '${value.operator}'`)
      }
      expression(value.left, references)
      expression(value.right, references)
      return
    }
    if (AST.isUnaryExpression(value)) {
      expression(value.operand, references)
      return
    }
    if (AST.isInterpolatedString(value)) {
      for (const part of value.parts) {
        if (AST.isStringInterpolation(part)) {
          expression(part.expression, references)
        }
      }
      return
    }
    if (AST.isValueReference(value)) {
      const target = value.target.ref
      if (
        !references || !target || !members.has(target)
        || !(AST.isAliasDeclaration(target) || AST.isStateDeclaration(target))
      ) {
        unsupported(value, 'references outside the scene scalar values')
      }
      return
    }
    unsupported(value, `expression '${value.$type}'`)
  }
  const scalar = (member: AST.StateDeclaration | AST.AliasDeclaration): void => {
    const type = Type.ofExpression(member.value)
    if (type.kind !== 'primitive' || type.primitive !== 'number') {
      unsupported(member, 'non-numeric scalar storage')
    }
    if (AST.isStateDeclaration(member) && member.persist) {
      unsupported(member, 'persisted state')
    }
    expression(member.value, !AST.isStateDeclaration(member))
  }
  const action = (member: AST.ActionDeclaration): void => {
    if (
      member.foreign || !member.block || member.runsLatest || member.returnType || AST.parametersOf(member).length > 0
    ) {
      unsupported(member, 'actions with foreign implementations, parameters, results, or runs latest')
      return
    }
    let wrote = false
    for (const statement of member.block.statements) {
      if (AST.isCheckStatement(statement)) {
        if (wrote) {
          ctx.error(statement, targetCapabilitiesValidationMessages.checkAfterWrite(profile.target))
        }
        expression(statement.condition)
        continue
      }
      if (AST.isSetStatement(statement)) {
        wrote = true
        const target = statement.target.ref
        if (
          !target || !members.has(target) || !AST.isStateDeclaration(target) || statement.members.length > 0
          || !['=', '+='].includes(statement.operator)
        ) {
          unsupported(statement, 'this state write')
        }
        expression(statement.value)
        continue
      }
      unsupported(statement, `action statement '${statement.$type}'`)
    }
  }
  const render = (node: AST.Render): void => {
    const binding = node.view?.ref ? profile.bindings.get(node.view.ref) : undefined
    if (!binding || binding === 'StackNav' || (AST.isRenderStatement(node) && node.injection)) {
      unsupported(node, 'unbound views, rendered navigators, or TypeScript injection')
      return
    }
    const view = node.view?.ref
    if (AST.isViewDeclaration(view)) {
      const pairs = ASTUtils.resolveArgumentBindings(view, node).pairs
      for (const pair of pairs) {
        const name = Type.parameterName(pair.parameter)
        if (name === 'Press') {
          const value = pair.argument.value
          const target = AST.isValueReference(value) ? value.target.ref : undefined
          if (!AST.isActionDeclaration(target) || !members.has(target)) {
            unsupported(value, 'anonymous or external button actions')
          }
        } else if (['Title', 'Value', 'Disabled', 'Submitting'].includes(name)) {
          expression(pair.argument.value)
        } else {
          unsupported(pair.argument, `argument '${name}'`)
        }
      }
    }
    const layoutNames = new Set<string>()
    for (const entry of node.layoutClause?.entries ?? []) {
      const name = AST.isLayoutWord(entry.head) ? entry.head.value : ''
      if (
        layoutNames.has(name) || !['gap', 'pad'].includes(name) || entry.condition || entry.terms.length !== 1
        || !AST.isLayoutNumberLiteral(entry.terms[0]) || (name === 'gap' && binding !== 'Col')
        || (AST.isLayoutWord(entry.head) && (entry.head.suffixes.length || entry.head.pathSegments.length))
      ) {
        unsupported(entry, 'this layout clause')
      }
      layoutNames.add(name)
    }
    for (const child of node.block?.statements ?? []) {
      if (AST.isEventHandler(child) && binding === 'FormButton') {
        const target = child.action?.target.ref
        if (child.event !== 'press' || child.block || !AST.isActionDeclaration(target) || !members.has(target)) {
          unsupported(child, 'events other than a scene-owned named press action')
        }
      } else if ((AST.isViewRender(child) || AST.isRenderStatement(child)) && ['Col', 'ScrollView'].includes(binding)) {
        render(child)
      } else {
        unsupported(child, `render member '${child.$type}'`)
      }
    }
  }
  if (scene.layoutClause || scene.response) {
    unsupported(scene, 'scene layout defaults or responses')
  }
  if ((scene.block?.statements.filter(AST.isRenderStatement).length ?? 0) !== 1) {
    unsupported(scene, 'scenes without exactly one render statement')
  }
  for (const member of scene.block?.statements ?? []) {
    if (AST.isStateDeclaration(member) || AST.isAliasDeclaration(member)) {
      scalar(member)
      continue
    }
    if (AST.isActionDeclaration(member)) {
      action(member)
      continue
    }
    if (AST.isRenderStatement(member)) {
      render(member)
      continue
    }
    if (AST.isDeclarationSlotFill(member) && member.name === 'Title' && member.value && !member.block) {
      expression(member.value)
      continue
    }
    unsupported(member, `scene member '${member.$type}'`)
  }
}
