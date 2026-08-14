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
    SetStatement | ToggleStatement | DoStatement | GuardActionStatement | IfActionStatement | AskStatement | RespondStatement | CreateStatement | UpdateStatement | DeleteStatement | ContextualPresentStatement | SelectionActivateStatement | DismissStatement | ReplaceStatement;

AskStatement:
    'let' name=ID '=' 'ask' dialogue=[DialogueDeclaration:ID] '(' argumentList=ArgumentList? ')';

RespondStatement:
    'respond' case=[EnumCase:ID]?;

ToggleStatement:
    'toggle' target=[StateDeclaration:ID];

GuardActionStatement:
    'guard' subject=SubjectExpression (caseBlock=GuardActionCaseBlock | single=GuardActionBranch);

GuardActionCaseBlock:
    '{' branches+=GuardActionBranch+ '}';

GuardActionBranch:
    case=SubjectCaseName ('->' payload=CasePayload?)? block=ActionBlock?;

IfActionStatement:
    'if' condition=Expression block=ActionBlock;

SetStatement:
    'set' target=[StateDeclaration:ID] operator=SetOperator value=Expression;

SetOperator returns string:
    '=' | '+=' | '-=' | '*=' | '/=';

DoStatement:
    'do' action=ActionTargetExpression '(' argumentList=ArgumentList? ')';

ActionTargetExpression:
    ActionExpression | MemberAccessExpression | ValueReference;
