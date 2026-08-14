grammar TaoActions

import "./expressions"
import "./views"
import "./data"
import "./navigation"
import "./terminals"

entry ActionsGrammarEntrypoint:
    StateDeclaration | ActionDeclaration | ActionExpression | ActionStatement;

StateDeclaration:
    'state' name=ID '=' value=Expression;

ActionDeclaration:
    visibility=DeclarationVisibility? 'action' name=ID parameterList=ParameterList? block=ActionBlock;

ActionExpression:
    ('action' | '->') block=ActionBlock;

ActionBlock:
    '{' statements+=ActionStatement* '}';

ActionStatement:
    SetStatement | ToggleStatement | DoStatement | WhenActionStatement | CreateStatement | UpdateStatement | DeleteStatement | PresentStatement | BackStatement;

ToggleStatement:
    'toggle' target=[StateDeclaration:ID];

// `otherwise` makes every action conditional total and terminates the branch list unambiguously.
WhenActionStatement:
    'when' branches+=WhenActionBranch+ otherwise=WhenActionOtherwise;

WhenActionBranch:
    condition=OrExpression '->' block=ActionBlock;

WhenActionOtherwise:
    'otherwise' '->' block=ActionBlock;

SetStatement:
    'set' target=[StateDeclaration:ID] operator=SetOperator value=Expression;

SetOperator returns string:
    '=' | '+=' | '-=' | '*=' | '/=';

DoStatement:
    'do' action=ActionTargetExpression '(' argumentList=ArgumentList? ')';

ActionTargetExpression:
    ActionExpression | MemberAccessExpression | ValueReference;
