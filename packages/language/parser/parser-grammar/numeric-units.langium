grammar TaoNumericUnits

import "./terminals"

entry NumericUnitsGrammarEntrypoint:
    NumericUnitBlock | NumericUnitName;

NumericUnitBlock:
    'units' '{' (units+=NumericUnitDeclaration (',' units+=NumericUnitDeclaration)* ','?)? '}';

NumericUnitDeclaration:
    name=NUMERIC_UNIT_ID sign='-'? scale=NUMBER ('(' default?='default' ')')?;

NumericUnitName returns string:
    (ID '.')* NUMERIC_UNIT_ID;
