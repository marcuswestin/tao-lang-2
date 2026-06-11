grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./injections"
import "./imports"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | UseStatement | AppUi | Injection | RenderStatement | ViewRender;

Declaration:
    AppDeclaration | UiDeclaration | LayoutDeclaration | AliasDeclaration;

type TopLevelStatement = Declaration | UseStatement;
type ViewStatement = AliasDeclaration | Render;
type NamedDeclaration = Declaration | ParameterDeclaration;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    name=ID type=PrimitiveType;

PrimitiveType returns string:
    'text' | 'number';
