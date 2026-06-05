grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | AppUi | Injection | Render;

Declaration:
    AppDeclaration | UiDeclaration | AliasDeclaration;

type TopLevelStatement = Declaration;
type ViewStatement = AliasDeclaration | Render;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    name=ID type=PrimitiveType;

PrimitiveType returns string:
    'text' | 'number';
