grammar TaoConditionals

import "./actions"
import "./blocks"
import "./expressions"

entry ConditionalsGrammarEntrypoint:
    WhenRenderStatement | WhenActionStatement | ForRenderStatement;

// `for` renders its block once per element, binding the element to a block-scoped name.
// The collection is a plain value reference, list, or parenthesized expression so the loop body's
// `{` is never read as a typed constructor's item literal.
ForRenderStatement:
    'for' item=LoopVariable 'in' collection=IterableExpression block=Block;

IterableExpression:
    ParenthesizedExpression | ListLiteral | MemberAccessExpression | ValueReference;

LoopVariable:
    name=ID;

// Every `when` is total: the required `otherwise` both states the default case and terminates the
// branch list, so a following statement is never mistaken for another branch condition.
WhenRenderStatement:
    'when' branches+=WhenRenderBranch+ otherwise=WhenRenderOtherwise;

WhenRenderBranch:
    condition=OrExpression '->' block=Block;

WhenRenderOtherwise:
    'otherwise' '->' block=Block;

WhenActionStatement:
    'when' branches+=WhenActionBranch+ otherwise=WhenActionOtherwise;

WhenActionBranch:
    condition=OrExpression '->' block=ActionBlock;

WhenActionOtherwise:
    'otherwise' '->' block=ActionBlock;
