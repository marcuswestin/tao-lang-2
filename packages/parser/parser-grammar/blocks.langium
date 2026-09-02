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

// A command is the discoverable verb: one action invocation, the words a person reads, and the
// slots that invocation still needs. It is a declaration, so it lives at module level or in a view
// or scene body — the placement `action` already has, and for the same reason: a command written
// in a view body closes over that view's parameters, state and actions.
CommandDeclaration:
    visibility=DeclarationVisibility? 'command' name=ID block=CommandBlock;

// The member alternatives are spelled out here rather than behind one rule so the parser can see
// what follows a bare name: a slot stands alone, and a fill always carries a value.
CommandBlock:
    '{' (members+=CommandDoClause | members+=CommandFill | members+=CommandSlot)* '}';

type CommandMember = CommandDoClause | CommandEntry;

interface CommandEntry {
    name: string
    labelled?: boolean
    value?: Expression
}

// The one invocation a command binds. The parentheses are the call form; a command binding a named
// action that takes no arguments may leave them off.
CommandDoClause:
    'do' action=ActionTargetExpression (called?='(' argumentList=ArgumentList? ')')?;

// Slots and fills share one member shape, because juxtaposition already declares a typed slot
// everywhere else in the language: `Document` is a slot the way `view CookScreen(Recipe)` reads,
// and `Icon "checkmark"` is a fill. Which one a member is falls out of the namespace its trailing
// name belongs to, and `Name: value` is the explicit fill for a name both namespaces claim.
CommandFill returns CommandEntry:
    name=ID (labelled?=':' value=Expression | value=CommandEntryExpression);

CommandSlot returns CommandEntry:
    name=ID;

// A juxtaposed member value never starts with a bare name on its own, because a bare name is what
// declares a slot. That one exclusion is what lets `Document` on its own line stay a slot while the
// `Title "Finish document"` under it stays a member: the two tokens after a member name always say
// which of the two is being read.
CommandEntryExpression infers Expression:
    CommandEntryNamedOperandExpression | CommandEntryOrExpression;

// A name may still open a member value when an operator follows it, which is how `Key primary + "n"`
// and `Enabled Draft is not empty` keep reading as values.
CommandEntryNamedOperandExpression infers Expression:
    {infer ValueReference} target=[ValueDeclaration:ID] (
        {infer CaseTestExpression.value=current} 'is' negated?='not'?
            (builtinCase=BuiltInSubjectCaseName | declaredCase=[CaseDeclaration:ID])
        | {infer BinaryExpression.left=current}
            operator=('+' | '-' | '*' | '/' | 'and' | 'or' | '==' | '!=' | '<=' | '>=' | '<' | '>')
            right=Expression
    );

CommandEntryOrExpression infers Expression:
    CommandEntryAndExpression
    ({infer BinaryExpression.left=current} operator='or' right=AndExpression)*;

CommandEntryAndExpression infers Expression:
    CommandEntryEqualityExpression
    ({infer BinaryExpression.left=current} operator='and' right=EqualityExpression)*;

CommandEntryEqualityExpression infers Expression:
    CommandEntryComparisonExpression
    ({infer BinaryExpression.left=current} operator=('==' | '!=') right=ComparisonExpression)*;

CommandEntryComparisonExpression infers Expression:
    CommandEntryCaseTestExpression
    ({infer BinaryExpression.left=current} operator=('<=' | '>=' | '<' | '>') right=CaseTestExpression)*;

CommandEntryCaseTestExpression infers Expression:
    CommandEntryAdditionExpression
    ({infer CaseTestExpression.value=current} 'is' negated?='not'?
        (builtinCase=BuiltInSubjectCaseName | declaredCase=[CaseDeclaration:ID]))?;

CommandEntryAdditionExpression infers Expression:
    CommandEntryMultiplicationExpression
    ({infer BinaryExpression.left=current} operator=('+' | '-') right=MultiplicationExpression)*;

CommandEntryMultiplicationExpression infers Expression:
    CommandEntryUnaryExpression
    ({infer BinaryExpression.left=current} operator=('*' | '/') right=UnaryExpression)*;

CommandEntryUnaryExpression infers Expression:
    ({infer UnaryExpression} operator=('not' | '-') operand=UnaryExpression)
    | CommandEntryPostfixExpression;

CommandEntryPostfixExpression infers Expression:
    CommandEntryPrimaryExpression ({infer PostfixMemberAccess.receiver=current} '.' member=ID)*;

CommandEntryPrimaryExpression infers Expression:
    WhenExpression | NowExpression | ActionExpression | TypedConstructor | ListLiteral | MemberAccessExpression
    | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral
    | FunctionCallExpression | RefinementExpression;

DeclarationSlotReferenceBlock:
    '{' references+=[CommandDeclaration:ID] (','? references+=[CommandDeclaration:ID])* '}';

// App properties and auxiliary navigators deliberately begin with the same ID and @name tokens as
// bare visual/slot uses. Keep every other broad statement parseable in an app body for a semantic
// placement diagnostic, while leaving those inherently overlapping bare forms to visual blocks.
AppBlockDiagnosticStatement:
    Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | FixtureDeclaration | ScenarioGroupDeclaration | RunStep | PressTextStep | TagPressStep | ExpectTextStep | ExpectCheckboxStateStep | ExpectInputValueStep | TagInputValueExpectation | ExpectGroupStep | ExpectScopeStep | EnterTextStep | TagEnterStep | SubmitInputStep | TagSubmitStep | SelectStep | BackTestStep | RelaunchStep | AdvanceStep | ExpectNavigationTitleStep | ExpectToolbarCommandStep | PressToolbarCommandStep | StateDeclaration | Injection | TagStatement | RenderStatement | RenderSlotDeclaration | EventHandler | LoopSelectHandler | WhenRenderStatement | GuardRenderStatement | IfRenderStatement | ForStatement | AsyncActionStatement;

// EntityQueryDeclaration is a declaration rather than a view-only statement: a module-level query
// is a named, app-lifetime value that carries visibility and crosses file boundaries like any other.
Declaration:
    PrimitiveDeclaration | AppDeclaration | ViewDeclaration | AliasDeclaration | TypeDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | EntityDataDeclaration | EntityQueryDeclaration | NavDeclaration | DatasourceDeclaration | DesignDeclaration;

// File statements are the declarations accepted directly by Tao source files.
type FileStatement = Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | FixtureDeclaration | ScenarioGroupDeclaration;
type TopLevelStatement = Declaration | ProjectDeclaration | UseStatement | UsePackageStatement | TestDeclaration | FixtureDeclaration | ScenarioGroupDeclaration;
// View statements are the declarations and render sites accepted by view/layout bodies.
ViewStatement returns Statement:
    ParsedStatement | DeclarationSlotFill;
type Statement = AppBlockDiagnosticStatement | ViewRender | RenderSlotUse | CallerContentStatement | CommandDeclaration | DeclarationSlotFill;
type NamedDeclaration = Declaration | ParameterDeclaration | StateDeclaration | EntityQueryDeclaration | CommandEntry | ForStatement | CasePayload | EntityDataField | CaseSetCase | AskStatement;
type ExportableDeclaration = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | ViewDeclaration | TypeDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | EntityDataDeclaration | EntityQueryDeclaration | DesignDeclaration;
type EmittingRuntimeBinding = AliasDeclaration | AppDeclaration | PrimitiveValueDeclaration | ViewDeclaration | TypeDeclaration | ActionDeclaration | CommandDeclaration | FunctionDeclaration | EntityDataDeclaration | EntityQueryDeclaration | DesignDeclaration;
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
