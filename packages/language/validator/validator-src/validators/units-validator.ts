import { Type, Units } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'

export const unitsValidationMessages = {
  unknownUnit: (unit: string, receiver: string) => `'${unit}' is not a unit or reading of ${receiver}.`,
  notAUnitReceiver: (unit: string, receiver: string) =>
    `Unit accessor '${unit}' expects a number or a unit value, got ${receiver}.`,
  crossFamily: (unit: string, family: string, unitFamily: string) =>
    `'${unit}' is a ${unitFamily} unit, and this value is a ${family}.`,
} as const

export const unitsValidationChecks = {
  [AST.PostfixMemberAccess.$type]: (access, ctx) => {
    const receiver = Type.ofExpression(access.receiver)
    if (
      AST.isMethodCallExpression(access.$container)
      && Type.associatedMethodDeclaration(receiver, access.member)
    ) {
      return
    }
    if (receiver.kind !== 'primitive') {
      return
    }
    const receiverName = Type.displayName(receiver)
    if (receiver.primitive === 'number') {
      if (!Units.familyOf(access.member)) {
        ctx.error(access, unitsValidationMessages.unknownUnit(access.member, receiverName))
      }
      return
    }
    if (!Units.isFamily(receiver.primitive)) {
      ctx.error(access, unitsValidationMessages.notAUnitReceiver(access.member, receiverName))
      return
    }
    const family = receiver.primitive
    if (Units.readingOf(family, access.member) || Units.ratioToBase(family, access.member) !== undefined) {
      return
    }
    // A unit of another family is the mistake worth naming precisely; anything else is unknown.
    const otherFamily = Units.familyOf(access.member)
    ctx.error(
      access,
      otherFamily
        ? unitsValidationMessages.crossFamily(access.member, family, otherFamily)
        : unitsValidationMessages.unknownUnit(access.member, receiverName),
    )
  },
} satisfies NodeValidationChecks
