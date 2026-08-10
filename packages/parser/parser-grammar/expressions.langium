grammar TaoExpressions

import "./aliases"
import "./actions"
import "./conditionals"
import "./blocks"
import "./types"
import "./terminals"

entry ExpressionsGrammarEntrypoint:
    ArgumentList;

// Invocation arguments are parenthesized everywhere, so any expression is a valid argument.
fragment InvocationArguments:
    (parenthesized?='(' argumentList=ArgumentList? ')')?;

ArgumentList:
    arguments+=Argument (',' arguments+=Argument)*;

Argument:
    (type=TypeReference ':' value=TypedArgumentValue) | value=Expression;

TypedArgumentValue:
    ItemLiteral | Expression;

Expression:
    ActionExpression | OrExpression;

// Operator precedence, loosest first. Each level folds into a left-associative BinaryExpression.
OrExpression:
    AndExpression ({infer BinaryExpression.left=current} operator='or' right=AndExpression)*;

AndExpression:
    ComparisonExpression ({infer BinaryExpression.left=current} operator='and' right=ComparisonExpression)*;

ComparisonExpression:
    AdditiveExpression (
        {infer BinaryExpression.left=current} operator=('==' | '!=' | '<=' | '>=' | '<' | '>') right=AdditiveExpression
    )*;

AdditiveExpression:
    MultiplicativeExpression ({infer BinaryExpression.left=current} operator=('+' | '-') right=MultiplicativeExpression)*;

MultiplicativeExpression:
    UnaryExpression ({infer BinaryExpression.left=current} operator=('*' | '/') right=UnaryExpression)*;

UnaryExpression:
    {infer UnaryOperation} operator=('not' | '-') operand=UnaryExpression | PrimaryExpression;

PrimaryExpression:
    ParenthesizedExpression | WhenExpression | ListLiteral | TypedConstructor | MemberAccessExpression | StringLiteral
    | NumberLiteral | BooleanLiteral | ValueReference;

ParenthesizedExpression:
    '(' expression=Expression ')';

// `when` picks the first branch whose condition holds; `otherwise` keeps every branch total.
WhenExpression:
    'when' branches+=WhenBranch+ 'otherwise' '->' otherwise=OrExpression;

WhenBranch:
    condition=OrExpression '->' value=OrExpression;

TypedConstructor:
    type=ConstructorTypeReference value=TypedConstructorValue;

TypedConstructorValue:
    StringLiteral | NumberLiteral | BooleanLiteral | ListLiteral | ItemLiteral;

// List elements are primary expressions so whitespace separation stays unambiguous: write `[1 (0 - 2)]`.
ListLiteral:
    '[' elements+=PrimaryExpression* ']';

ItemLiteral:
    '{' properties+=ItemProperty* '}';

ItemProperty:
    value=Expression;

MemberAccessExpression:
    target=[ValueDeclaration:ID] '.' members+=ID ('.' members+=ID)*;

StringLiteral:
    value=STRING;

NumberLiteral:
    value=NUMBER;

BooleanLiteral:
    value=BooleanValue;

BooleanValue returns string:
    'true' | 'false';

ValueReference:
    target=[ValueDeclaration:ID];

type ValueDeclaration = AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration | LoopVariable;
