grammar TaoActions

import "./expressions"
import "./views"
import "./data"
import "./navigation"
import "./terminals"

entry ActionsGrammarEntrypoint:
    StateDeclaration | ActionDeclaration | ActionExpression | ActionStatement;

StateDeclaration:
    'state' name=ID ('is' type=TypeReference)? '=' value=Expression ('(' persist?='persist' ')')?;

ActionDeclaration:
    visibility=DeclarationVisibility? 'action' name=ID parameterList=ParameterList
    (runsLatest?='runs' 'latest')? (block=ActionBlock | foreign=ForeignActionImplementation);

// A foreign action publishes the failures its TypeScript implementation may deliberately raise.
// Repeating a case is intentional: one stable case may have several place-specific sentences.
ForeignActionImplementation:
    failures+=ActionFailureDeclaration* 'from' path=USE_IMPORT_PATH;

ActionFailureDeclaration:
    'fails' case=[CaseSetCase:ID] sentence=STRING;

ActionExpression:
    ('action' | '->') block=ActionBlock;

ActionBlock:
    '{' statements+=ActionStatement* '}';

ActionStatement:
    AsyncActionStatement | SetStatement | ToggleStatement | DoStatement | FailStatement | GuardActionStatement | IfActionStatement | AskStatement | RespondStatement | CreateStatement | UpdateStatement | DeleteStatement | ContextualPresentStatement | SelectionActivateStatement | DismissStatement | ReplaceStatement | DeclarationSlotFill;

FailStatement:
    'fail' case=[CaseSetCase:ID] sentence=STRING;

AsyncActionStatement:
    'async' block=ActionBlock;

AskStatement:
    'let' name=ID '=' 'ask' view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')';

RespondStatement:
    'respond' case=[CaseSetCase:ID]?;

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

// `do` runs one verb. An action is invoked with its call parentheses; a command is invoked by name
// and fills its remaining slots with `with { ... }`, which is the ordinary refinement form.
DoStatement:
    'do' action=ActionTargetExpression (called?='(' argumentList=ArgumentList? ')')?;

ActionTargetExpression:
    ActionExpression | RefinementExpression | MemberAccessExpression | ValueReference;
