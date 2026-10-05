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
    ('returns' returnType=TypeExpression optionalResult?='?'?)? (runsLatest?='runs' 'latest')? (block=ActionBlock | foreign=ForeignActionImplementation);

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
    AsyncActionStatement | SetStatement | ToggleStatement | DoStatement | WhenDoStatement | DeferStatement | FailStatement | CheckStatement | GuardActionStatement | IfActionStatement | AskStatement | ActionResultStatement | RespondStatement | CreateStatement | UpdateStatement | DeleteStatement | RetryStatement | ContextualPresentStatement | SelectionActivateStatement | DismissStatement | ReplaceStatement | DeclarationSlotFill;

FailStatement:
    'fail' case=[CaseSetCase:ID] sentence=STRING;

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
    case=WhenDoCaseName '->' payload=CasePayload? block=(ActionBlock | AtomicActionBlock);

WhenDoCaseName returns string:
    SubjectCaseName | 'otherwise';

BarWhenDoOutcome infers WhenDoOutcome:
    barSyntax?='|' case=SubjectCaseName '->' payload=CasePayload? block=(ActionBlock | AtomicActionBlock);

WhenDoOtherwise:
    barSyntax?='|' 'otherwise' '->' block=(ActionBlock | AtomicActionBlock);

AtomicActionBlock infers ActionBlock:
    statements+=ActionStatement;

ActionTargetExpression:
    ActionExpression | NamedActionTarget;

// A verb named at the invocation: a value by name, or a member reached through one.
NamedActionTarget:
    MemberAccessExpression | ValueReference;

// Retry resubmits an unresolved recorded data mutation, never its originating action.
RetryStatement:
    'retry' target=DataRowExpression;
