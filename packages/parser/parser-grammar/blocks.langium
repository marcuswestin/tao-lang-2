grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./actions"
import "./conditionals"
import "./injections"
import "./imports"
import "./project"
import "./tests"
import "./types"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

// Statement stays broad so validators can report context-specific placement errors.
Statement:
    Declaration | ProjectDeclaration | UseStatement | TestDeclaration | CheckDeclaration | RunStep | PressTextStep | ExpectTextStep | AppView | StateDeclaration | Injection | RenderStatement | ViewRender | WhenRenderStatement;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
type ViewStatement = AliasDeclaration | StateDeclaration | ActionDeclaration | Render | WhenRenderStatement;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration;
type ExportableDeclaration = AliasDeclaration | RenderableDeclaration | TypeDeclaration | ActionDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | RenderableDeclaration | ActionDeclaration;
type ParameterizedDeclaration = RenderableDeclaration | ActionDeclaration;
type BlockStatementOwner = AppDeclaration | ProjectDeclaration | RenderableDeclaration | Render | ActionDeclaration | ActionExpression;
// OwnedBlockStatement includes test steps and other context-only statements for generic block traversal.
type OwnedBlockStatement = ActionStatement | ProjectStatement | Statement;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    inlineType=ParameterTypeDeclaration | type=NamedTypeReference;
