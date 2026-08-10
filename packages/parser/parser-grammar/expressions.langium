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
    ('.' parameterName=ID value=ArgumentValue)
    | (type=TypeReference ':' value=TypedArgumentValue)
    | value=ArgumentValue;

TypedArgumentValue:
    ItemLiteral | Expression;

// Direct render/action/function arguments exclude an unlabelled TypedConstructor because
// `Text Value { }` must keep parsing `{ }` as the render child block. Parentheses admit
// any otherwise ambiguous expression without weakening that shipped boundary.
ArgumentValue infers Expression:
    '(' Expression ')' | ConditionalExpression | ArgumentUnaryExpression | ActionExpression
    | MemberAccessExpression | FunctionCallExpression | InterpolationExpression | StringLiteral | NumberLiteral
    | BooleanLiteral | NoneLiteral | ValueReference;

ArgumentUnaryExpression infers Expression:
    {infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression;

FunctionDeclaration:
    visibility=DeclarationVisibility? 'function' name=ID parameterList=ParameterList? 'returns' returnType=TypeReference '=' value=Expression;

Expression:
    ConditionalExpression | OrExpression;

ConditionalExpression:
    'if' condition=OrExpression 'then' whenTrue=Expression 'else' whenFalse=Expression;

OrExpression infers Expression:
    AndExpression ({infer BinaryExpression.left=current} operator='or' right=AndExpression)*;

AndExpression infers Expression:
    EqualityExpression ({infer BinaryExpression.left=current} operator='and' right=EqualityExpression)*;

EqualityExpression infers Expression:
    ComparisonExpression ({infer BinaryExpression.left=current} operator=('==' | '!=') right=ComparisonExpression)*;

ComparisonExpression infers Expression:
    AdditionExpression ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>') right=AdditionExpression)*;

AdditionExpression infers Expression:
    MultiplicationExpression ({infer BinaryExpression.left=current} operator=('+' | '-') right=MultiplicationExpression)*;

MultiplicationExpression infers Expression:
    UnaryExpression ({infer BinaryExpression.left=current} operator=('*' | '/') right=UnaryExpression)*;

UnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression) | PrimaryExpression;

PrimaryExpression infers Expression:
    '(' Expression ')' | ActionExpression | TypedConstructor | ListLiteral | MemberAccessExpression | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | InterpolationExpression | FunctionCallExpression | ValueReference;

TypedConstructor:
    type=ConstructorTypeReference value=TypedConstructorValue;

TypedConstructorValue:
    StringLiteral | NumberLiteral | ListLiteral | ItemLiteral;

ListLiteral:
    '[' elements+=Expression* ']';

ItemLiteral:
    '{' properties+=ItemProperty* '}';

ItemProperty:
    value=Expression;

MemberAccessExpression:
    target=[ValueDeclaration:ID] '.' members+=ID ('.' members+=ID)*;

FunctionCallExpression:
    function=[FunctionDeclaration:ID] '(' argumentList=ArgumentList? ')';

InterpolationExpression:
    'interpolate' parts+=Expression (',' parts+=Expression)*;

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

type ValueDeclaration = AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration | QueryDeclaration | ForStatement;
