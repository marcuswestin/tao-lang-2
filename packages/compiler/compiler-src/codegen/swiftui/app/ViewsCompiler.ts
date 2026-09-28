import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import type { TargetCapabilities } from '@validator/validators/target-capabilities-validator'
import { Compile } from '../Compile'

export const ViewsCompiler = {
  Scene(scene: AST.ViewDeclaration, profile: TargetCapabilities): string {
    const members = scene.block!.statements
    const declarations = members.flatMap(member => {
      if (AST.isStateDeclaration(member)) {
        return [`    @State var ${Compile.Name(member)}: Double = ${Compile.Expression(member.value)}`]
      }
      if (AST.isAliasDeclaration(member)) {
        return [`    var ${Compile.Name(member)}: Double { ${Compile.Expression(member.value)} }`]
      }
      if (AST.isActionDeclaration(member)) {
        return [Compile.Action(member)]
      }
      return []
    })
    const title = members.find(member => AST.isDeclarationSlotFill(member) && member.name === 'Title')
    const render = members.find(AST.isRenderStatement)
    Assert.defined(render, 'validated scene has a render')
    const body = Compile.Render(render, profile)
    const navigationTitle = AST.isDeclarationSlotFill(title) && title.value
      ? `\n        .navigationTitle(${Compile.Expression(title.value)})`
      : ''
    return `import SwiftUI\n\nstruct TaoScene_${scene.name}: View {\n${
      declarations.join('\n\n')
    }\n\n    var body: some View {\n${indent(body, 8)}${navigationTitle}\n    }\n}\n`
  },

  Action(action: AST.ActionDeclaration): string {
    const statements = action.block!.statements.map(statement => {
      if (AST.isCheckStatement(statement)) {
        return `guard ${Compile.Expression(statement.condition)} else { return }`
      }
      Assert(
        AST.isSetStatement(statement) && AST.isStateDeclaration(statement.target.ref),
        'validated Swift action writes scalar state',
      )
      return `${Compile.Name(statement.target.ref)} ${statement.operator} ${Compile.Expression(statement.value)}`
    })
    return `    func ${Compile.Name(action)}() {\n${indent(statements.join('\n'), 8)}\n    }`
  },

  Render(render: AST.Render, profile: TargetCapabilities): string {
    const target = render.view?.ref
    Assert(AST.isViewDeclaration(target), 'validated native render targets a view')
    const binding = profile.bindings.get(target)
    const argumentsByName = new Map(
      ASTUtils.resolveArgumentBindings(target, render).pairs
        .map(pair => [Type.parameterName(pair.parameter), pair.argument.value]),
    )
    const argument = (name: string, fallback: string): string => {
      const value = argumentsByName.get(name)
      return value ? Compile.Expression(value) : fallback
    }
    const entries = render.layoutClause?.entries ?? []
    const layoutValue = (name: string): number | undefined => {
      const term = entries.find(entry => AST.isLayoutWord(entry.head) && entry.head.value === name)?.terms[0]
      return AST.isLayoutNumberLiteral(term) ? term.value : undefined
    }
    const children = (render.block?.statements ?? []).filter((child): child is AST.Render =>
      AST.isViewRender(child) || AST.isRenderStatement(child)
    )
    let code: string
    if (binding === 'Text') {
      code = `Text(${argument('Value', '""')})\n    .lineLimit(1)`
    } else if (binding === 'FormButton') {
      const event = render.block?.statements.find(AST.isEventHandler)
      const press = argumentsByName.get('Press')
      const action = event?.action?.target.ref ?? (AST.isValueReference(press) ? press.target.ref : undefined)
      Assert(AST.isActionDeclaration(action), 'validated FormButton has a named action')
      const title = argument('Title', '""')
      const submitting = argument('Submitting', 'false')
      code = `Button(${submitting} ? "Saving…" : ${title}) {\n    ${Compile.Name(action)}()\n}\n.disabled(${
        argument('Disabled', 'false')
      } || ${submitting})\n.accessibilityLabel(${title})`
    } else {
      const container = binding === 'Col'
        ? `VStack(alignment: .leading, spacing: ${layoutValue('gap') ?? 0})`
        : 'ScrollView'
      code = `${container} {\n${indent(children.map(child => Compile.Render(child, profile)).join('\n'), 4)}\n}`
      if (binding === 'Col') {
        code += '\n.frame(maxWidth: .infinity, alignment: .leading)'
      }
    }
    const padding = layoutValue('pad')
    if (padding !== undefined) {
      code += `\n.padding(${padding})`
    }
    return code
  },
} as const

function indent(code: string, spaces: number): string {
  return code.split('\n').map(line => `${' '.repeat(spaces)}${line}`).join('\n')
}
