grammar TaoNumericUnits

import "./terminals"

entry NumericUnitsGrammarEntrypoint:
    NumericUnitBlock | NumericUnitName;

NumericUnitBlock:
    'units' '{' (units+=NumericUnitDeclaration (',' units+=NumericUnitDeclaration)* ','?)? '}';

NumericUnitDeclaration:
    name=ID sign='-'? scale=NUMBER ('(' default?='default' ')')?;

NumericUnitName returns string:
    ID ('.' ID)*;
