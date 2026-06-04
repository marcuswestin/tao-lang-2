grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | AliasDeclaration | AppUi | Injection | Render;

Declaration:
    AppDeclaration | ViewDeclaration;

type TopLevelStatement = Declaration | AliasDeclaration;
type ViewStatement = AliasDeclaration | Render;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    name=ID type=PrimitiveType;

PrimitiveType returns string:
    'text' | 'number';
