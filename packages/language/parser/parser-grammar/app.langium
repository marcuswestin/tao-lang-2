grammar TaoApp

import "./blocks"
import "./data"
import "./terminals"
import "./restoration"
import "./visibility"

entry AppGrammarEntrypoint:
    AppDeclaration;

type AppValueDeclaration = AppDeclaration | AliasDeclaration;

// An app declaration can carry visibility (for example `folder app Name`) so that sibling files,
// scenario sidecars, and tests in the same directory reach it without an import.
AppDeclaration:
    visibility=DeclarationVisibility? 'app' name=ID ('=' value=Expression | block=AppBlock);

AppBlock:
    '{' statements+=(AppStatement | AppBlockDiagnosticStatement)* '}';

AppStatement:
    AppAuxiliaryNavigator | AppView | AppProperty | RestorationPolicy;

AppAuxiliaryNavigator:
    name=USE_IMPORT_PATH value=ConfigurationConstructor;

// The app root is a view with arguments: `view Shell(Navigator)` binds the shell's parameters exactly
// as `Initial Shell(Navigator)` would, and the bare form `view Shell` is the same reference without a
// binding. Tao synthesizes the slot navigator that mounts it. The rule lives here for the app block
// and is reused by an app variant's patch block, where `with { view Shell(Other) }` rebinds the root.
AppView:
    'view' view=[ViewDeclaration:ID] ('(' argumentList=ArgumentList? ')')?;

// Primitive app contracts are Prelude-owned, so supplied slots remain parseable without a grammar edit.
AppProperty:
    name=ID (patch=PropertyConfigurationPatch | value=Expression);
