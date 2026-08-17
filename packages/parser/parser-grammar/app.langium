grammar TaoApp

import "./blocks"
import "./data"
import "./terminals"

entry AppGrammarEntrypoint:
    AppDeclaration;

type AppValueDeclaration = AppDeclaration | AliasDeclaration;

// An app is always declared in the entry file and never inside a package, so no import relation can
// reach it beyond its own directory and a visibility marker would have nothing left to widen.
AppDeclaration:
    'app' name=ID ('=' value=Expression | block=AppBlock);

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
