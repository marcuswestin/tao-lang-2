grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./injections"
import "./imports"
import "./project"
import "./types"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | ProjectDeclaration | UseStatement | AppView | Injection | RenderStatement | ViewRender;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | AliasDeclaration | TypeDeclaration;

type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement;
type ViewStatement = AliasDeclaration | Render;
type NamedDeclaration = Declaration;
type ExportableDeclaration = AliasDeclaration | RenderableDeclaration | TypeDeclaration;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    type=TypeReference ('as' name=ID)?;
