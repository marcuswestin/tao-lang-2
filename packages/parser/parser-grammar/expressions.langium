grammar TaoExpressions

import "./aliases"
import "./actions"
import "./blocks"
import "./configuration"
import "./types"
import "./terminals"
import "./restoration"

entry ExpressionsGrammarEntrypoint:
    ArgumentList | Expression | FunctionDeclaration;

ArgumentList:
    arguments+=Argument (',' arguments+=Argument)*;

Argument:
    (label=ID ':')? value=ArgumentValue;

ArgumentValue infers Expression:
    Expression;

// `returns` accepts a full type expression so `returns { ... } { body }` parses.
FunctionDeclaration:
    visibility=DeclarationVisibility? 'function' name=ID parameterList=ParameterList
    ('returns' returnType=TypeExpression)? block=FunctionBlock;

FunctionBlock:
    '{' statements+=FunctionStatement* '}';

FunctionStatement:
    ReturnStatement | IfFunctionStatement;

ReturnStatement:
    'return' value=Expression;

IfFunctionStatement:
    'if' condition=Expression block=FunctionBlock;

Expression:
    FromExpression;

// Declaration slots reserve a brace-initial value for reference blocks (`Toolbar { Save }`) and
// an immediately parenthesized value for a bare child invocation (`Child(...)`). Otherwise they
// retain the ordinary expression hierarchy, including grouping after an operator, reactive calls,
// state, conditionals, and typed constructors. A brace-valued item can still be named with an
// explicit declared constructor.
DeclarationSlotExpression infers Expression:
    DeclarationSlotFromExpression;

DeclarationSlotFromExpression infers Expression:
    DeclarationSlotOrExpression ({infer FromExpression.expression=current} 'from' path=USE_IMPORT_PATH)?;

DeclarationSlotOrExpression infers Expression:
    DeclarationSlotAndExpression
    ({infer BinaryExpression.left=current} operator='or' right=AndExpression)*;

DeclarationSlotAndExpression infers Expression:
    DeclarationSlotEqualityExpression
    ({infer BinaryExpression.left=current} operator='and' right=EqualityExpression)*;

DeclarationSlotEqualityExpression infers Expression:
    DeclarationSlotComparisonExpression
    ({infer BinaryExpression.left=current} operator=('==' | '!=') right=ComparisonExpression)*;

DeclarationSlotComparisonExpression infers Expression:
    DeclarationSlotCaseTestExpression
    ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>') right=CaseTestExpression)*;

DeclarationSlotCaseTestExpression infers Expression:
    DeclarationSlotAdditionExpression
    ({infer CaseTestExpression.value=current} 'is' negated?='not'?
        (builtinCase=BuiltInSubjectCaseName | declaredCase=[CaseDeclaration:ID]))?;

DeclarationSlotAdditionExpression infers Expression:
    DeclarationSlotMultiplicationExpression
    ({infer BinaryExpression.left=current} operator=('+' | '-') right=MultiplicationExpression)*;

DeclarationSlotMultiplicationExpression infers Expression:
    DeclarationSlotUnaryExpression
    ({infer BinaryExpression.left=current} operator=('*' | '/') right=UnaryExpression)*;

DeclarationSlotUnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression)
    | DeclarationSlotPostfixExpression;

DeclarationSlotPostfixExpression infers Expression:
    DeclarationSlotPrimaryExpression ({infer PostfixMemberAccess.receiver=current} '.' member=ID)*;

DeclarationSlotPrimaryExpression infers Expression:
    WhenExpression | NowExpression | ActionExpression | TypedConstructor | PrimitiveConfigurationConstructor
    | ConfigurationConstructor | ListLiteral | MemberAccessExpression
    | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral
    | FunctionCallExpression | RefinementExpression | ValueReference;

// `<expression> from <path>` (Decisions §15) binds loosest, taking the whole expression to its left,
// so a bridged call reads the way a local one would. The names in that expression resolve to the
// module's named exports rather than to Tao declarations.
FromExpression infers Expression:
    OrExpression ({infer FromExpression.expression=current} 'from' path=USE_IMPORT_PATH)?;

OrExpression infers Expression:
    AndExpression ({infer BinaryExpression.left=current} operator='or' right=AndExpression)*;

AndExpression infers Expression:
    EqualityExpression ({infer BinaryExpression.left=current} operator='and' right=EqualityExpression)*;

EqualityExpression infers Expression:
    ComparisonExpression ({infer BinaryExpression.left=current} operator=('==' | '!=') right=ComparisonExpression)*;

ComparisonExpression infers Expression:
    CaseTestExpression ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>') right=CaseTestExpression)*;

CaseTestExpression infers Expression:
    AdditionExpression ({infer CaseTestExpression.value=current} 'is' negated?='not'?
        (builtinCase=BuiltInSubjectCaseName | declaredCase=[CaseDeclaration:ID]))?;

AdditionExpression infers Expression:
    MultiplicationExpression ({infer BinaryExpression.left=current} operator=('+' | '-') right=MultiplicationExpression)*;

MultiplicationExpression infers Expression:
    UnaryExpression ({infer BinaryExpression.left=current} operator=('*' | '/') right=UnaryExpression)*;

// Postfix `.member` on any primary carries unit accessors (`1.ms`, `(1.cm).meters`).
UnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression) | PostfixExpression;

PostfixExpression infers Expression:
    PrimaryExpression ({infer PostfixMemberAccess.receiver=current} '.' member=ID)*;

PrimaryExpression infers Expression:
    '(' Expression ')' | WhenExpression | NowExpression | ActionExpression | TypedConstructor | PrimitiveConfigurationConstructor | ConfigurationConstructor | InferredConfigurationConstructor | ListLiteral | MemberAccessExpression | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | FunctionCallExpression | RefinementExpression | ValueReference;

// A bare configuration block instantiates a declared type. `with` is reserved for copying and
// patching an existing configured value.
ConfigurationConstructor:
    type=[ConstructorDeclaration:ID] ('.' members+=ID)* (block=ConfigurationBlock | value=DeclaredConstructorValue);

// `with` is the one refinement operation. Primitive constructors accept the bare-block
// construction sugar as well as its explicit spelling.
PrimitiveConfigurationConstructor:
    primitive=ConfigurationPrimitive ('with')? block=ConfigurationBlock;

ConfigurationPrimitive returns string:
    'app' | 'nav' | 'datasource';

// A bare block takes its base type from the declaration context that owns it.
InferredConfigurationConstructor:
    block=ConfigurationBlock;

type ConfiguredValue = ConfigurationConstructor;
type ConstructorDeclaration = TypeDeclaration | ParameterizedDeclaration;

ConfigurationBlock:
    '{' (entries+=ConfigurationEntry (','? entries+=ConfigurationEntry)*)? '}';

ConfigurationEntry:
    restoration=RestorationPolicy
    | key=USE_IMPORT_PATH block=ConfigurationBlock
    | label=ID ':' expression=Expression
    | name=ID ('.' nameMembers+=ID)* (value=ConfigurationValue | block=ConfigurationBlock)
    | reference=[ValueDeclaration:ID]
    | expression=NonIdentifierConstructorEntryValue;

ConfigurationValue:
    PropertyConfigurationPatch | ConfigurationConstructor | ConfigurationKeyValue
    | ListLiteral | StringLiteral | NumberLiteral | BooleanLiteral | ViewBinding | ConfigurationReference;

// A parameterized view remains a first-class presentation descriptor in configuration position.
// Its arguments are captured as live bindings when the owning nav is configured; this is distinct
// from a function call, which produces an ordinary expression value.
ViewBinding:
    view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')';

NonIdentifierConstructorEntryValue infers Expression:
    TypedConstructor | ListLiteral | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral;

PropertyConfigurationPatch:
    'with' block=ConfigurationBlock;

ConfigurationKeyValue:
    key=USE_IMPORT_PATH;

ConfigurationReference:
    target=[NamedDeclaration:ID];

// `when` covers two or more outcomes and is the value-producing form (Decisions §8). The block form
// is total, closed by `otherwise`; the compact form is the two-outcome sibling for a yes/no subject,
// where the mandatory label before the second branch is `not` or the type's own no-pole alias.
//
// Both forms take the same subject rule, so the parser needs no lookahead to choose between them: a
// `when` subject stops before `{`, which is what distinguishes a block from a bare item constructor,
// and it stops before `/`, which is what leaves the compact form's separator visible.
WhenExpression:
    'when' subject=WhenSubjectExpression
    ('{' branches+=WhenBranch+ otherwise=WhenOtherwise '}'
        | positive=WhenSubjectExpression ('/' negativeLabel=CompactNegativeLabel negative=WhenSubjectExpression)?);

CompactNegativeLabel returns string:
    'not' | ID;

WhenSubjectExpression infers Expression:
    WhenSubjectOrExpression;

WhenSubjectOrExpression infers Expression:
    WhenSubjectAndExpression ({infer BinaryExpression.left=current} operator='or' right=WhenSubjectAndExpression)*;

WhenSubjectAndExpression infers Expression:
    WhenSubjectEqualityExpression ({infer BinaryExpression.left=current} operator='and'
        right=WhenSubjectEqualityExpression)*;

WhenSubjectEqualityExpression infers Expression:
    WhenSubjectComparisonExpression ({infer BinaryExpression.left=current} operator=('==' | '!=')
        right=WhenSubjectComparisonExpression)*;

WhenSubjectComparisonExpression infers Expression:
    WhenSubjectCaseTestExpression ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>')
        right=WhenSubjectCaseTestExpression)*;

WhenSubjectCaseTestExpression infers Expression:
    WhenSubjectAdditionExpression ({infer CaseTestExpression.value=current} 'is' negated?='not'?
        (builtinCase=BuiltInSubjectCaseName | declaredCase=[CaseDeclaration:ID]))?;

WhenSubjectAdditionExpression infers Expression:
    WhenSubjectMultiplicationExpression ({infer BinaryExpression.left=current} operator=('+' | '-')
        right=WhenSubjectMultiplicationExpression)*;

// `/` is the compact form's separator here, so division inside a `when` subject or branch value is
// written with parentheses.
WhenSubjectMultiplicationExpression infers Expression:
    WhenSubjectUnaryExpression ({infer BinaryExpression.left=current} operator='*'
        right=WhenSubjectUnaryExpression)*;

WhenSubjectUnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=WhenSubjectUnaryExpression) | WhenSubjectPostfixExpression;

WhenSubjectPostfixExpression infers Expression:
    WhenSubjectPrimaryExpression ({infer PostfixMemberAccess.receiver=current} '.' member=ID)*;

// Every brace-initial primary is left out, which is what lets the block form be recognized by its
// opening brace alone.
WhenSubjectPrimaryExpression infers Expression:
    '(' Expression ')' | WhenExpression | NowExpression | ListLiteral | MemberAccessExpression
    | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral
    | FunctionCallExpression | ValueReference;

WhenBranch:
    case=SubjectCaseName '->' value=OrExpression;

WhenOtherwise:
    'otherwise' '->' value=OrExpression;

SubjectExpression infers Expression:
    '(' Expression ')' | ListLiteral | MemberAccessExpression | FunctionCallExpression | InterpolatedString
    | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | ValueReference;

SubjectCaseName returns string:
    BuiltInSubjectCaseName | ID;

BuiltInSubjectCaseName returns string:
    'empty' | 'loading' | 'refreshing' | 'stale' | 'missing' | 'unauthorized' | 'error' | 'true' | 'false';

CasePayload:
    name=ID;

TypedConstructor:
    type=ConstructablePrimitiveTypeReference value=TypedConstructorValue;

DeclaredConstructorValue:
    StringLiteral | NumberLiteral | ListLiteral;

TypedConstructorValue:
    StringLiteral | NumberLiteral | ListLiteral | ItemLiteral;

ListLiteral:
    '[' (elements+=Expression (',' elements+=Expression)*)? ']';

ItemLiteral:
    '{' (properties+=ItemProperty (','? properties+=ItemProperty)*)? '}';

ItemProperty:
    (label=ID ':')? value=Expression;

MemberAccessExpression:
    target=[ValueDeclaration:ID] '.' members+=ID ('.' members+=ID)*;

FunctionCallExpression:
    function=[FunctionDeclaration:ID] '(' argumentList=ArgumentList? ')';

InterpolatedString:
    INTERPOLATED_STRING_START parts+=InterpolatedStringPart* STRING_END;

InterpolatedStringPart:
    InterpolatedStringText | StringInterpolation;

InterpolatedStringText:
    value=STRING_TEXT;

StringInterpolation:
    INTERPOLATION_START expression=Expression '}';

StringLiteral:
    value=STRING;

NumberLiteral:
    value=NUMBER;

BooleanLiteral:
    value=BooleanLiteralValue;

BooleanLiteralValue returns string:
    'true' | 'false';

NoneLiteral:
    value='none';

NowExpression:
    {infer NowExpression} 'now';

ValueReference:
    target=[ValueDeclaration:ID];

RefinementExpression:
    target=[RefinementBaseDeclaration:ID] 'with' patchBlock=ConfigurationBlock;

type RefinementBaseDeclaration = ValueDeclaration | TypeDeclaration;
type ValueDeclaration = AppDeclaration | NavDeclaration | DatasourceDeclaration | AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration | CommandDeclaration | CommandEntry | EntityQueryDeclaration | ForStatement | CasePayload | ViewDeclaration | EntityDataField | CaseSetCase | AskStatement | DesignDeclaration;
