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
import "./scenarios"
import "./tests"
import "./types"
import "./terminals"

entry BlocksGrammarEntrypoint:
    Block;

// ParsedStatement stays broad so validators can report context-specific placement errors. The
// declared Statement union additionally includes view-only members without making their bare
// syntax globally ambiguous.
ParsedStatement returns Statement:
    AppBlockDiagnosticStatement | ViewRender | RenderSlotUse | CallerContentStatement;

// Supplied declaration slots are named body members whose vocabulary comes from the declaration's
// primitive family in Prelude.tao. Scalar slots take an ordinary reactive expression; list-valued
// command surfaces use a reference block so `Toolbar { Save Share }` stays distinct from rendering.
interface DeclarationSlotFill {
    name: string
    value?: Expression
    block?: DeclarationSlotReferenceBlock
}

DeclarationSlotFill returns DeclarationSlotFill:
    name=ID (block=DeclarationSlotReferenceBlock | value=DeclarationSlotExpression);

// A command binds one intent invocation into a zero-argument, focus-scoped action value. Its
// affordance members are declaration-slot fills so they share the same reactive expression shape.
CommandDeclaration:
    'command' name=ID '=' action=[ActionDeclaration:ID] '(' argumentList=ArgumentList? ')'
    ('with' metadata=DeclarationSlotBlock)?;

DeclarationSlotReferenceBlock:
    '{' references+=[CommandDeclaration:ID]+ '}';

DeclarationSlotBlock:
    '{' fills+=DeclarationSlotFill* '}';

// App properties and auxiliary navigators deliberately begin with the same ID and @name tokens as
// bare visual/slot uses. Keep every other broad statement parseable in an app body for a semantic
// placement diagnostic, while leaving those inherently overlapping bare forms to visual blocks.
AppBlockDiagnosticStatement:
    Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | FixtureDeclaration | ScenarioGroupDeclaration | RunStep | PressTextStep | TagPressStep | PressPhaseStep | HoverStep | FocusStep | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | RelaunchStep | AdvanceStep | ExpectNavigationTitleStep | ExpectToolbarCommandStep | PressToolbarCommandStep | StateDeclaration | EntityQueryDeclaration | CommandDeclaration | Injection | TagStatement | RenderStatement | RenderSlotDeclaration | EventHandler | LoopSelectHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement | AsyncActionStatement;

Declaration:
    PrimitiveDeclaration | AppDeclaration | ViewDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | NavDeclaration | DatasourceDeclaration | DesignDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | FixtureDeclaration | ScenarioGroupDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | FixtureDeclaration | ScenarioGroupDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
ViewStatement returns Statement:
    ParsedStatement | DeclarationSlotFill;
type Statement = AppBlockDiagnosticStatement | ViewRender | RenderSlotUse | CallerContentStatement | CommandDeclaration | DeclarationSlotFill;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration | EntityQueryDeclaration | CommandDeclaration | ForStatement | CasePayload | EntityDataField | CaseSetCase | AskStatement;
type ExportableDeclaration = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | ViewDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | DesignDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | ViewDeclaration | TypeDeclaration | ActionDeclaration | FunctionDeclaration | EntityDataDeclaration | DesignDeclaration;
type ParameterizedDeclaration = ViewDeclaration | ActionDeclaration | FunctionDeclaration;
type BlockStatementOwner = AppDeclaration | ProjectDeclaration | ViewDeclaration | Render | ActionDeclaration | ActionExpression | ForStatement;
type CaseDeclaration = CaseSetCase | EntityDataField;
// OwnedBlockStatement includes test steps and other context-only statements for generic block traversal.
type OwnedBlockStatement = ActionStatement | AppStatement | ProjectStatement | Statement;

interface Block {
    statements: Statement[]
}

Block returns Block:
    '{' statements+=ParsedStatement* '}';

ParameterList:
    '(' (parameters+=ParameterDeclaration (',' parameters+=ParameterDeclaration)*)? ')';

// Parameters take optionality and a bare default. The parenthesized trait list is data-only.
ParameterDeclaration:
    (inlineType=ParameterTypeDeclaration | type=NamedTypeReference optional?='?'?)
    ('default' defaultValue=Expression)?;
