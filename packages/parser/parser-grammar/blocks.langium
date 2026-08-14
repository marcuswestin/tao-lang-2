grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./actions"
import "./data"
import "./configuration"
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
    Declaration | ProjectDeclaration | UseStatement | TestDeclaration | CheckDeclaration | RunStep | PressTextStep | TagPressStep | ExpectTextStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | DataStatusStep | StateDeclaration | EntityQueryDeclaration | Injection | TagStatement | RenderStatement | ViewRender | EventHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement;

Declaration:
    AppDeclaration | ViewDeclaration | LayoutDeclaration | UiDeclaration | DialogueDeclaration | AliasDeclaration | TypeDeclaration | EnumDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | NavDeclaration | DatasourceDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
type ViewStatement = AliasDeclaration | StateDeclaration | EntityQueryDeclaration | ActionDeclaration | TagStatement | Render | EventHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration | EntityQueryDeclaration | ForStatement | CasePayload | EntityDataField | EnumCase | AskStatement;
type ExportableDeclaration = AliasDeclaration | VisualDeclaration | TypeDeclaration | EnumDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | ConfigurableDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | VisualDeclaration | EnumDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | ConfigurableDeclaration;
type ParameterizedDeclaration = VisualDeclaration | ActionDeclaration | FunctionDeclaration;
type BlockStatementOwner = AppDeclaration | ProjectDeclaration | VisualDeclaration | Render | ActionDeclaration | ActionExpression | ForStatement;
type CaseDeclaration = EnumCase | EntityDataField;
// OwnedBlockStatement includes test steps and other context-only statements for generic block traversal.
type OwnedBlockStatement = ActionStatement | AppStatement | ProjectStatement | Statement;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*;

ParameterDeclaration:
    (inlineType=ParameterTypeDeclaration | type=NamedTypeReference) ('default' defaultValue=Expression)?;
