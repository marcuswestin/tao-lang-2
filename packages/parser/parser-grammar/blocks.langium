grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./actions"
import "./data"
import "./injections"
import "./imports"
import "./navigation"
import "./project"
import "./tests"
import "./types"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

// Statement stays broad so validators can report context-specific placement errors.
Statement:
    Declaration | ProjectDeclaration | UseStatement | TestDeclaration | CheckDeclaration | RunStep | PressTextStep | ExpectTextStep | ExpectInputValueStep | EnterTextStep | SubmitInputStep | BackTestStep | DataStatusStep | AppView | AppStack | AppDatasource | StateDeclaration | QueryDeclaration | Injection | RenderStatement | ViewRender | WhenRenderStatement | ForStatement;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | DataDeclaration | StackDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
type ViewStatement = AliasDeclaration | StateDeclaration | QueryDeclaration | ActionDeclaration | Render | WhenRenderStatement | ForStatement;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration | QueryDeclaration | ForStatement;
type ExportableDeclaration = AliasDeclaration | RenderableDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | DataDeclaration | StackDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | RenderableDeclaration | ActionDeclaration | FunctionDeclaration | DataDeclaration | StackDeclaration;
type ParameterizedDeclaration = RenderableDeclaration | ActionDeclaration | FunctionDeclaration;
type BlockStatementOwner = AppDeclaration | ProjectDeclaration | RenderableDeclaration | Render | ActionDeclaration | ActionExpression | ForStatement;
// OwnedBlockStatement includes test steps and other context-only statements for generic block traversal.
type OwnedBlockStatement = ActionStatement | ProjectStatement | Statement;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    (inlineType=ParameterTypeDeclaration | type=NamedTypeReference) ('default' defaultValue=Expression)?;
