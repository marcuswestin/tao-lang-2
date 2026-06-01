grammar TaoExpressions

import "./terminals"

entry ExpressionsGrammarEntrypoint:
    ArgumentList;

ArgumentList:
    arguments+=Argument (',' arguments+=Argument)*;

Argument:
    value=StringLiteral;

StringLiteral:
    value=STRING;
