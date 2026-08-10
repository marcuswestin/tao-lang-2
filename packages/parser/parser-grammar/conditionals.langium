grammar TaoConditionals

import "./actions"
import "./blocks"
import "./expressions"

entry ConditionalsGrammarEntrypoint:
    WhenRenderStatement | WhenActionStatement;

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
