grammar TaoActions

import "./expressions"
import "./views"
import "./data"
import "./navigation"
import "./terminals"

entry ActionsGrammarEntrypoint:
    StateDeclaration | ActionDeclaration | ActionExpression | ActionStatement;

StateDeclaration:
    'state' name=ID (('is' type=TypeReference)? '=' value=Expression | value=BooleanLiteral) ('(' persist?='persist' ')')?;

ActionDeclaration:
    visibility=DeclarationVisibility? static?='static'? 'action' (receiverName=ID '.')? name=ID parameterList=ParameterList
    ('returns' returnType=TypeExpression optionalResult?='?'? | '->' returnType=TypeExpression)? (runsLatest?='runs' 'latest')? (block=ActionBlock | foreign=ForeignActionImplementation);

// A foreign action publishes the failures its TypeScript implementation may deliberately raise.
// Repeating a case is intentional: one stable case may have several place-specific sentences.
ForeignActionImplementation:
    failures+=ActionFailureDeclaration* 'from' path=USE_IMPORT_PATH;

ActionFailureDeclaration:
    'fails' case=[FailureDeclaration:ID] sentence=STRING;

ActionExpression:
    ('action' | '->') block=ActionBlock;

ActionBlock:
    '{' statements+=ActionStatement* '}';

// Action-owned loops reuse the view loop's AST while retaining an action-only block body.
ActionLoopStatement infers ForStatement:
    'loop' collection=ForCollectionExpression '/' name=ID block=ActionBlock;

ActionStatement:
    AsyncActionStatement | AliasDeclaration | ReturnStatement | SetStatement | ToggleStatement | DoStatement | WhenDoStatement | WhenActionStatement | DeferStatement | FailStatement | CheckStatement | GuardActionStatement | IfActionStatement | AskStatement | ActionResultStatement | RespondStatement | CreateStatement | UpdateStatement | DeleteStatement | RetryStatement | ContextualPresentStatement | SelectionActivateStatement | DismissStatement | ReplaceStatement | ActionLoopStatement | DeclarationSlotFill;

FailStatement:
    'fail' case=[FailureDeclaration:ID] sentence=STRING;

// `check` is an action's early exit: a false condition skips the rest of the action without failing.
CheckStatement:
    'check' condition=Expression;

AsyncActionStatement:
    'async' block=ActionBlock;

AskStatement:
    'let' name=ID '=' 'ask' view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')';

ActionResultStatement:
    'let' name=ID '=' invocation=DoStatement;

RespondStatement:
    'respond' case=[CaseSetCase:ID]?;

ToggleStatement:
    'toggle' target=[ValueDeclaration:ID] ('.' members+=ID)*;

GuardActionStatement:
    'guard' subject=SubjectExpression (caseBlock=GuardActionCaseBlock | single=GuardActionBranch);

GuardActionCaseBlock:
    '{' branches+=GuardActionBranch+ '}';

GuardActionBranch:
    case=SubjectCaseName ('->' payload=CasePayload?)? block=ActionBlock?;

// A source action `when` runs every matching branch; this remains distinct from value-producing
// WhenExpression and invocation-specific WhenDoStatement.
WhenActionStatement:
    'when' subject=SubjectExpression '{' branches+=WhenActionBranch+ otherwise=WhenActionOtherwise? '}';

WhenActionBranch:
    case=SubjectCaseName (payload=CasePayload '->' | '->') block=ActionBlock;

WhenActionOtherwise:
    'otherwise' '->' block=ActionBlock;

IfActionStatement:
    'if' condition=Expression block=ActionBlock;

SetStatement:
    'set' target=[MutableDeclaration:ID] ('.' members+=ID)* operator=SetOperator value=Expression;

SetOperator returns string:
    '=' | '+=' | '-=' | '*=' | '/=';

// `do` runs one verb with its call parentheses. An action and a command are invoked the same way:
// `do SaveWorkspace()` and `do Finish(Document)` bind their arguments by label or by type through
// one mechanism, and a command's parameters are its slots.
DoStatement:
    'do' action=ActionTargetExpression '(' argumentList=ArgumentList? ')' (then?='then' ('{' outcomes+=WhenDoOutcome+ '}' | outcomes+=BarWhenDoOutcome* otherwise=WhenDoOtherwise))?;

DeferStatement:
    'defer' (block=ActionBlock | invocation=DeferredInvocation);

DeferredInvocation infers DoStatement:
    action=ActionTargetExpression '(' argumentList=ArgumentList? ')';

// `when do` runs its verb exactly as `do` does, but contains the verb's failure at this site and
// names what happens next. The outcomes are `saved`, `rejected`, `error`, and any case the verb
// declares; `saved` and `rejected` are validated words rather than keywords, so both stay usable as
// names elsewhere.
WhenDoStatement:
    'when' invocation=DoStatement ('{' outcomes+=WhenDoOutcome+ '}'
      | outcomes+=BarWhenDoOutcome* otherwise=WhenDoOtherwise);

WhenDoOutcome:
    case=WhenDoCaseName (payload=CasePayload '->' | '->' payload=CasePayload?) block=(ActionBlock | AtomicActionBlock);

WhenDoCaseName returns string:
    SubjectCaseName | 'otherwise';

BarWhenDoOutcome infers WhenDoOutcome:
    barSyntax?='|' case=SubjectCaseName '->' payload=CasePayload? block=(ActionBlock | AtomicActionBlock);

WhenDoOtherwise:
    barSyntax?='|' 'otherwise' '->' block=(ActionBlock | AtomicActionBlock);

AtomicActionBlock infers ActionBlock:
    statements+=ActionStatement;

ActionTargetExpression:
    ActionExpression | CallResultActionTarget | NamedActionTarget;

// The call produces the receiver; the outer DoStatement parentheses still belong to the action.
CallResultActionTarget infers PostfixMemberAccess:
    receiver=FunctionCallExpression '.' member=ID;

// A verb named at the invocation: a value by name, or a member reached through one.
NamedActionTarget:
    MemberAccessExpression | ValueReference;

// Retry resubmits an unresolved recorded data mutation, never its originating action.
RetryStatement:
    'retry' target=DataRowExpression;
