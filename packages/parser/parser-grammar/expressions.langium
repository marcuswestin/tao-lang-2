grammar TaoExpressions

import "./aliases"
import "./actions"
import "./blocks"
import "./terminals"

entry ExpressionsGrammarEntrypoint:
    ArgumentList;

ArgumentList:
    arguments+=Argument (',' arguments+=Argument)*;

Argument:
    value=Expression;

Expression:
    StringLiteral | NumberLiteral | ActionExpression | ValueReference;

StringLiteral:
    value=STRING;

NumberLiteral:
    value=NUMBER;

ValueReference:
    target=[ValueDeclaration:ID];

type ValueDeclaration = AliasDeclaration | ParameterDeclaration | StateDeclaration | ActionDeclaration;
