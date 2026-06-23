grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./actions"
import "./injections"
import "./imports"
import "./project"
import "./tests"
import "./types"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

Statement:
    Declaration | ProjectDeclaration | UseStatement | TestDeclaration | CheckDeclaration | RunStep | ExpectTextStep | AppView | StateDeclaration | Injection | RenderStatement | ViewRender;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration;

type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
type ViewStatement = AliasDeclaration | StateDeclaration | ActionDeclaration | Render;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration;
type ExportableDeclaration = AliasDeclaration | RenderableDeclaration | TypeDeclaration | ActionDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | RenderableDeclaration | ActionDeclaration;
type ParameterizedDeclaration = RenderableDeclaration | ActionDeclaration;
type BlockStatementOwner = AppDeclaration | ProjectDeclaration | RenderableDeclaration | Render | ActionDeclaration | ActionExpression;
type OwnedBlockStatement = ActionStatement | ProjectStatement | Statement;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    inlineType=ParameterTypeDeclaration | type=NamedTypeReference;
