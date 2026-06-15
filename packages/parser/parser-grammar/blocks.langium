grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./injections"
import "./imports"
import "./project"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | ProjectDeclaration | UseStatement | AppView | Injection | RenderStatement | ViewRender;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | AliasDeclaration;

type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement;
type ViewStatement = AliasDeclaration | Render;
type NamedDeclaration = Declaration | ParameterDeclaration;
type ExportableDeclaration = AliasDeclaration | RenderableDeclaration;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    name=ID type=PrimitiveType;

PrimitiveType returns string:
    'text' | 'number';
