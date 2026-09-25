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
    AppBlockDiagnosticStatement | ViewRender | RenderSlotUse | CallerContentStatement | ViewCommandExclusion;

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

// A command is the discoverable verb: the slots its invocation still needs, the words a person
// reads, and one action invocation. Its slots are a parameter list, exactly as an action declares
// its own, so the block holds only member fills and the one `do`. That is what lets juxtaposition
// mean one thing inside the block — bind — so `Enabled CanSave` is a value and `command Like(Track
// Song)` renames a typed slot, neither needing a second spelling. It is a declaration, so it lives
// at module level or in a view or scene body — the placement `action` already has, and for the
// same reason: a command written in a view body closes over that view's parameters, state and
// actions.
CommandDeclaration:
    visibility=DeclarationVisibility? 'command' name=ID parameterList=ParameterList block=CommandBlock;

CommandBlock:
    '{' (members+=CommandDoClause | members+=CommandFill)* '}';

type CommandMember = CommandDoClause | CommandFill;

// The one invocation a command binds: an inline action, or a named action with its call
// parentheses, exactly as a `do` statement writes one.
CommandDoClause:
    'do' (action=ActionExpression | action=NamedActionTarget '(' argumentList=ArgumentList? ')');

// A fill binds a value to one member of `primitive command`, with the ordinary expression grammar.
CommandFill:
    name=ID value=Expression;

DeclarationSlotReferenceBlock:
    '{' references+=[CommandDeclaration:ID] (','? references+=[CommandDeclaration:ID])* '}';

// App properties and auxiliary navigators deliberately begin with the same ID and @name tokens as
// bare visual/slot uses. Keep every other broad statement parseable in an app body for a semantic
// placement diagnostic, while leaving those inherently overlapping bare forms to visual blocks.
AppBlockDiagnosticStatement:
    Declaration | EntityQueryDeclaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | ScenarioGroupDeclaration | RunStep | PressTextStep | TagPressStep | PressWordStep | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | ExpectInteractionStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | RelaunchStep | AdvanceStep | ExpectNavigationTitleStep | ExpectToolbarCommandStep | PressToolbarCommandStep | StateDeclaration | Injection | TagStatement | RenderStatement | RenderSlotDeclaration | EventHandler | LoopSelectHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement | AsyncActionStatement;

// EntityQueryDeclaration remains in the broad diagnostic statement rule so a query written at file
// level parses far enough for the validator to explain the unsupported shape. It is deliberately
// absent from every declaration/export/runtime-binding union: queries are local view statements.
Declaration:
    PrimitiveDeclaration | AppDeclaration | ViewDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | PhraseDeclaration | EntityDataDeclaration | NavDeclaration | DatasourceDeclaration | DesignDeclaration | FixtureDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | ScenarioGroupDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | ScenarioGroupDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
ViewStatement returns Statement:
    ParsedStatement | DeclarationSlotFill;
type Statement = AppBlockDiagnosticStatement | ViewRender | RenderSlotUse | CallerContentStatement | CommandDeclaration | DeclarationSlotFill | ViewCommandExclusion | InteractionWordStep;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration | EntityQueryDeclaration | ForStatement | CasePayload | EntityDataField | CaseSetCase | AskStatement;
type MutableDeclaration = StateDeclaration | ParameterDeclaration;
type ExportableDeclaration = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | ViewDeclaration | TypeDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | PhraseDeclaration | EntityDataDeclaration | DesignDeclaration | FixtureDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | ViewDeclaration | TypeDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | PhraseDeclaration | EntityDataDeclaration | DesignDeclaration;
type ParameterizedDeclaration = ViewDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | PhraseDeclaration;
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
    (copy?='copy' | mutable?='mutable')?
    (inlineType=ParameterTypeDeclaration | type=NamedTypeReference optional?='?'?)
    ('default' defaultValue=Expression)?;
