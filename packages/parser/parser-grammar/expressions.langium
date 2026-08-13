grammar TaoExpressions

import "./aliases"
import "./actions"
import "./blocks"
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

FunctionDeclaration:
    visibility=DeclarationVisibility? 'function' name=ID parameterList=ParameterList? 'returns' returnType=TypeReference '=' value=Expression;

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

UnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression) | PrimaryExpression;

PrimaryExpression infers Expression:
    '(' Expression ')' | WhenExpression | ActionExpression | TypedConstructor | ListLiteral | MemberAccessExpression | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | FunctionCallExpression | ValueReference;

// Configured values are closed, typed records owned by stdlib and app contracts. `with` is
// canonical for provider configuration and omitted for navigation construction.
ProviderConfiguredValue:
    type=[TypeDeclaration:ID] with?='with' block=ConfigurationBlock;

NavigationConfiguredValue:
    type=[TypeDeclaration:ID] block=ConfigurationBlock;

type ConfiguredValue = ProviderConfiguredValue | NavigationConfiguredValue;

ConfigurationBlock:
    '{' entries+=ConfigurationEntry* '}';

ConfigurationEntry:
    name=ID value=ConfigurationValue;

ConfigurationValue:
    NavigationConfiguredValue | ProviderConfiguredValue | StringLiteral | NumberLiteral | BooleanLiteral | ValueReference;

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
    'empty' | 'loading' | 'error' | 'true' | 'false';

CasePayload:
    name=ID;

TypedConstructor:
    type=ConstructorTypeReference value=TypedConstructorValue;

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

ValueReference:
    target=[ValueDeclaration:ID];

type ValueDeclaration = AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration | EntityQueryDeclaration | ForStatement | CasePayload | UiDeclaration | EntityDataField | EnumCase;
