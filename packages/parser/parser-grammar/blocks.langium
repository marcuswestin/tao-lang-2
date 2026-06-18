grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./actions"
import "./injections"
import "./imports"
import "./project"
import "./types"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | ProjectDeclaration | UseStatement | AppView | StateDeclaration | Injection | RenderStatement | ViewRender;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration;

type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement;
type ViewStatement = AliasDeclaration | StateDeclaration | ActionDeclaration | Render;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration;
type ExportableDeclaration = AliasDeclaration | RenderableDeclaration | TypeDeclaration | ActionDeclaration;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    type=TypeReference ('as' name=ID)?;
