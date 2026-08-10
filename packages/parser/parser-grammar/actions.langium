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
    SetStatement | DoStatement | CreateStatement | UpdateStatement | DeleteStatement | PresentStatement | BackStatement;

SetStatement:
    'set' target=[StateDeclaration:ID] operator=SetOperator value=Expression;

SetOperator returns string:
    '=' | '+=' | '-=' | '*=' | '/=';

DoStatement:
    'do' action=ActionTargetExpression argumentList=ArgumentList?;

ActionTargetExpression:
    ActionExpression | MemberAccessExpression | ValueReference;
