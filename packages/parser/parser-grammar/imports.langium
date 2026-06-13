grammar TaoImports

import "./expressions"

entry ImportsGrammarEntrypoint:
    UseStatement;

UseStatement:
    'use' importedDeclarations+=[Declaration:ID] (',' importedDeclarations+=[Declaration:ID])* ('from' importPath=USE_IMPORT_PATH)?;
