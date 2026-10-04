grammar TaoProject

import "./terminals"

entry ProjectGrammarEntrypoint:
    PackageDeclaration;

// A publication projects modules in the containing .tao project. Omitting `name` declares its default.
PackageDeclaration:
    'package' block=PackageBlock;

PackageBlock:
    '{' statements+=PackageStatement* '}';

PackageStatement:
    PackageName | PackageVersion | PackageLicense | PackageIncludes | PackageRequires;

PackageName:
    'name' value=STRING;

PackageVersion:
    'version' value=SemverValue;

PackageLicense:
    'license' value=PackageWord;

PackageIncludes:
    'includes' modules+=USE_IMPORT_PATH+;

// Requirement AST nodes retain origin through aliases for publication and app dependency graphs.
PackageRequires:
    'requires' (ts?='ts' npm=NPM_LOCATOR 'version' version=SemverValue 'as' alias=PackageWord
        | (name=STRING 'from')? locator=USE_IMPORT_PATH 'version' version=SemverValue bindings=ModuleBindings?);

ModuleBindings:
    '{' bindings+=ModuleBinding* '}';

ModuleBinding:
    module=USE_IMPORT_PATH ('as' alias=USE_IMPORT_PATH)?;

SemverValue returns string:
    STRING | SEMVER_VALUE;

PackageWord returns string:
    ID ('-' (ID | NUMBER | 'only' | 'or' | 'with'))*;
