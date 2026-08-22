grammar TaoBlocks

import "./app"
import "./views"
import "./aliases"
import "./actions"
import "./data"
import "./design"
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
    AppBlockDiagnosticStatement | ViewRender | RenderSlotUse | CallerContentStatement;

// App properties and auxiliary navigators deliberately begin with the same ID and @name tokens as
// bare visual/slot uses. Keep every other broad statement parseable in an app body for a semantic
// placement diagnostic, while leaving those inherently overlapping bare forms to visual blocks.
AppBlockDiagnosticStatement:
    Declaration | ProjectDeclaration | UseStatement | TestDeclaration | RunStep | PressTextStep | TagPressStep | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | StateDeclaration | EntityQueryDeclaration | Injection | TagStatement | RenderStatement | RenderSlotDeclaration | EventHandler | LoopSelectHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement | AsyncActionStatement;

Declaration:
    PrimitiveDeclaration | AppDeclaration | ViewDeclaration | LayoutDeclaration | FrameDeclaration | UiDeclaration | DialogueDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | NavDeclaration | DatasourceDeclaration | DesignDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | TestDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
type ViewStatement = AliasDeclaration | StateDeclaration | EntityQueryDeclaration | ActionDeclaration | TagStatement | Render | RenderSlotDeclaration | RenderSlotUse | CallerContentStatement | EventHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration | EntityQueryDeclaration | ForStatement | CasePayload | EntityDataField | CaseSetCase | AskStatement;
type ExportableDeclaration = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | VisualDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | DesignDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | VisualDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | DesignDeclaration;
type ParameterizedDeclaration = VisualDeclaration | ActionDeclaration | FunctionDeclaration;
type BlockStatementOwner = AppDeclaration | ProjectDeclaration | VisualDeclaration | Render | ActionDeclaration | ActionExpression | ForStatement;
type CaseDeclaration = CaseSetCase | EntityDataField;
// OwnedBlockStatement includes test steps and other context-only statements for generic block traversal.
type OwnedBlockStatement = ActionStatement | AppStatement | ProjectStatement | Statement;

Block:
    '{' statements+=Statement* '}';

ParameterList:
    '(' (parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*)? ')';

// Parameters take optionality and a bare default. The parenthesized trait list is data-only.
ParameterDeclaration:
    (inlineType=ParameterTypeDeclaration | type=NamedTypeReference optional?='?'?)
    ('default' defaultValue=Expression)?;
