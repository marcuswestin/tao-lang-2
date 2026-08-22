grammar TaoExpressions

import "./aliases"
import "./actions"
import "./blocks"
import "./configuration"
import "./types"
import "./terminals"

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
    OrExpression;

OrExpression infers Expression:
    AndExpression ({infer BinaryExpression.left=current} operator='or' right=AndExpression)*;

AndExpression infers Expression:
    EqualityExpression ({infer BinaryExpression.left=current} operator='and' right=EqualityExpression)*;

EqualityExpression infers Expression:
    ComparisonExpression ({infer BinaryExpression.left=current} operator=('==' | '!=') right=ComparisonExpression)*;

ComparisonExpression infers Expression:
    CaseTestExpression ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>') right=CaseTestExpression)*;

CaseTestExpression infers Expression:
    AdditionExpression ({infer CaseTestExpression.value=current} 'is' (builtinCase=BuiltInSubjectCaseName | declaredCase=[CaseDeclaration:ID]))?;

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
    '(' Expression ')' | WhenExpression | NowExpression | ActionExpression | TypedInjectionExpression | TypedConstructor | PrimitiveConfigurationConstructor | ConfigurationConstructor | InferredConfigurationConstructor | ListLiteral | MemberAccessExpression | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | FunctionCallExpression | RefinementExpression | ValueReference;

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
    key=USE_IMPORT_PATH block=ConfigurationBlock
    | label=ID ':' expression=Expression
    | name=ID ('.' nameMembers+=ID)* (value=ConfigurationValue | block=ConfigurationBlock)
    | reference=[ValueDeclaration:ID]
    | expression=NonIdentifierConstructorEntryValue;

ConfigurationValue:
    PropertyConfigurationPatch | ConfigurationConstructor | ConfigurationKeyValue
    | StringLiteral | NumberLiteral | BooleanLiteral | ConfigurationReference;

NonIdentifierConstructorEntryValue infers Expression:
    TypedConstructor | ListLiteral | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral;

PropertyConfigurationPatch:
    'with' block=ConfigurationBlock;

ConfigurationKeyValue:
    key=USE_IMPORT_PATH;

ConfigurationReference:
    target=[NamedDeclaration:ID];

// `otherwise` makes every subject conditional total and terminates the branch list unambiguously.
WhenExpression:
    'when' subject=SubjectExpression '{' branches+=WhenBranch+ otherwise=WhenOtherwise '}';

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
    'empty' | 'loading' | 'missing' | 'unauthorized' | 'error' | 'true' | 'false';

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
type ValueDeclaration = AppDeclaration | NavDeclaration | DatasourceDeclaration | AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration | EntityQueryDeclaration | ForStatement | CasePayload | UiDeclaration | EntityDataField | CaseSetCase | AskStatement | DesignDeclaration;
