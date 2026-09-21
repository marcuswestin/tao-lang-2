grammar TaoImports

import "./expressions"

entry ImportsGrammarEntrypoint:
    UseStatement | UsePackageStatement;

UseStatement:
    'use' importedDeclarations+=[Declaration:ID] (',' importedDeclarations+=[Declaration:ID])* ('from' importPath=USE_IMPORT_PATH)?;

// `use package <path> [as name]` imports a package as a namespace. Without `as`, the namespace
// takes the path's last segment; `as` renames, which also covers segments that collide with
// keywords (`use package @tao/nav as navs`).
UsePackageStatement:
    'use' 'package' importPath=USE_IMPORT_PATH ('as' name=ID)?;
