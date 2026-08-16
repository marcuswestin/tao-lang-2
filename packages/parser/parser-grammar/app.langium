grammar TaoApp

import "./blocks"
import "./data"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

type AppValueDeclaration = AppDeclaration | AliasDeclaration;

AppDeclaration:
    visibility=DeclarationVisibility? 'app' name=ID ('=' value=Expression | block=AppBlock);

AppBlock:
    '{' statements+=(AppStatement | AppBlockDiagnosticStatement)* '}';

AppStatement:
    AppAuxiliaryNavigator | AppView | AppProperty;

AppAuxiliaryNavigator:
    name=USE_IMPORT_PATH value=ConfigurationConstructor;

AppView:
    'view' view=[ViewDeclaration:ID];

// Primitive app contracts are Prelude-owned, so supplied slots remain parseable without a grammar edit.
AppProperty:
    name=ID (patch=PropertyConfigurationPatch | value=Expression);
