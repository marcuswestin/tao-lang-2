grammar TaoExpressions

import "./aliases"
import "./blocks"
import "./types"
import "./terminals"

entry ExpressionsGrammarEntrypoint:
    ArgumentList;

ArgumentList:
    arguments+=Argument (',' arguments+=Argument)*;

Argument:
    value=Expression;

Expression:
    TypeCastExpression | PrimaryExpression;

PrimaryExpression:
    TypedConstructor | ListLiteral | MemberAccessExpression | StringLiteral | NumberLiteral | ValueReference;

TypeCastExpression:
    value=PrimaryExpression 'as' type=TypeReference;

TypedConstructor:
    type=ConstructorTypeReference '.' value=TypedConstructorValue;

ConstructorTypeReference:
    primitive=PrimitiveType | target=[TypeDefinition:ID];

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

type ValueDeclaration = AliasDeclaration | ParameterDeclaration;
