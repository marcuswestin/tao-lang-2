grammar TaoActions

import "./data"
import "./expressions"
import "./views"
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
    SetStatement | ToggleStatement | DoStatement | WhenActionStatement | CreateStatement | UpdateStatement | DeleteStatement;

ToggleStatement:
    'toggle' target=[StateDeclaration:ID];

SetStatement:
    'set' target=[StateDeclaration:ID] operator=SetOperator value=Expression;

SetOperator returns string:
    '=' | '+=' | '-=' | '*=' | '/=';

DoStatement:
    'do' action=ActionTargetExpression InvocationArguments;

ActionTargetExpression:
    ActionExpression | MemberAccessExpression | ValueReference;
