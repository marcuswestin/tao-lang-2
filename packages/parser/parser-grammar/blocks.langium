grammar TaoBlocks

import "./app"
import "./views"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | AppUi | Injection | Render;

Declaration:
    AppDeclaration | ViewDeclaration;

type TopLevelStatement = Declaration;
type ViewStatement = Render;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    name=ID type=PrimitiveType;

PrimitiveType returns string:
    'text';
