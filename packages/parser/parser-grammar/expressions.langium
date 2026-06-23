grammar TaoExpressions

import "./aliases"
import "./actions"
import "./blocks"
import "./types"
import "./terminals"

entry ExpressionsGrammarEntrypoint:
    ArgumentList;

ArgumentList:
    arguments+=Argument (',' arguments+=Argument)*;

Argument:
    (type=TypeReference ':' value=TypedArgumentValue) | value=ArgumentValue;

TypedArgumentValue:
    ItemLiteral | Expression;

ArgumentValue:
    MemberAccessExpression | StringLiteral | NumberLiteral | ActionExpression | ValueReference;

Expression:
    ActionExpression | TypedConstructor | PrimaryExpression;

PrimaryExpression:
    ListLiteral | MemberAccessExpression | StringLiteral | NumberLiteral | ValueReference;

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

StringLiteral:
    value=STRING;

NumberLiteral:
    value=NUMBER;

ValueReference:
    target=[ValueDeclaration:ID];

type ValueDeclaration = AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration;
