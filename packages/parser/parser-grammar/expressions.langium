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
    AdditionExpression ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>') right=AdditionExpression)*;

AdditionExpression infers Expression:
    MultiplicationExpression ({infer BinaryExpression.left=current} operator=('+' | '-') right=MultiplicationExpression)*;

MultiplicationExpression infers Expression:
    UnaryExpression ({infer BinaryExpression.left=current} operator=('*' | '/') right=UnaryExpression)*;

UnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression) | PrimaryExpression;

PrimaryExpression infers Expression:
    '(' Expression ')' | WhenExpression | ActionExpression | TypedConstructor | ListLiteral | MemberAccessExpression | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | InterpolationExpression | FunctionCallExpression | ValueReference;

// `otherwise` makes every value conditional total and terminates the branch list unambiguously.
WhenExpression:
    'when' branches+=WhenBranch+ otherwise=WhenOtherwise;

WhenBranch:
    condition=OrExpression '->' value=OrExpression;

WhenOtherwise:
    'otherwise' '->' value=OrExpression;

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
