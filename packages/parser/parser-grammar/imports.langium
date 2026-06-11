grammar TaoImports

import "./expressions"

entry ImportsGrammarEntrypoint:
    UseStatement;

UseStatement:
    'use' importedDeclarations+=[Declaration:ID] (',' importedDeclarations+=[Declaration:ID])* 'from' modulePath=USE_MODULE_PATH;
