grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./layout"
import "./visibility"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration | LayoutDeclaration | FrameDeclaration | UiDeclaration | DialogueDeclaration;

TagStatement:
    tag=TagOrHexColor;

UiDeclaration:
    visibility=DeclarationVisibility? 'ui' name=ID parameterList=ParameterList block=Block;

DialogueDeclaration:
    visibility=DeclarationVisibility? 'dialogue' name=ID parameterList=ParameterList
    'responds' response=[TypeDeclaration:ID] block=Block;

ViewDeclaration:
    visibility=DeclarationVisibility? 'view' name=ID parameterList=ParameterList block=Block;

LayoutDeclaration:
    visibility=DeclarationVisibility? 'layout' name=ID parameterList=ParameterList block=Block;

FrameDeclaration:
    visibility=DeclarationVisibility? 'frame' name=ID parameterList=ParameterList block=Block;

type RenderableDeclaration = ViewDeclaration | LayoutDeclaration | FrameDeclaration;
type VisualDeclaration = RenderableDeclaration | UiDeclaration | DialogueDeclaration;

// Frames own optional, single-fill visual holes. A use without a render value places the slot in
// the frame implementation; a use with a render value fills that slot at one call site.
RenderSlotDeclaration:
    name=USE_IMPORT_PATH '=' 'empty';

RenderSlotUse:
    slot=[RenderSlotDeclaration:USE_IMPORT_PATH] render=ViewRender?;

// Layouts and frames place their opaque unnamed caller content explicitly in their render tree.
CallerContentStatement:
    {infer CallerContentStatement} '@@content';

RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause?
        | view=[RenderableDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?);

ViewRender:
    view=[RenderableDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?;

EventHandler:
    'on' event=EventName (action=ValueReference | '->' payload=CasePayload? block=ActionBlock);

EventName returns string:
    'press' | 'change' | 'submit';

type Render = RenderStatement | ViewRender;

// `otherwise` makes every subject render conditional total and terminates the branch list unambiguously.
WhenRenderStatement:
    'when' subject=SubjectExpression '{' branches+=WhenRenderBranch+ otherwise=WhenRenderOtherwise '}';

WhenRenderBranch:
    case=SubjectCaseName '->' payload=CasePayload? block=Block;

WhenRenderOtherwise:
    'otherwise' '->' block=Block;

IfRenderStatement:
    'if' condition=Expression block=Block;

GuardRenderStatement:
    'guard' subject=SubjectExpression (caseBlock=GuardRenderCaseBlock | single=GuardRenderBranch);

GuardRenderCaseBlock:
    '{' branches+=GuardRenderBranch+ '}';

GuardRenderBranch:
    case=SubjectCaseName ('->' payload=CasePayload?)? block=Block?;

ForStatement:
    'loop' collection=ForCollectionExpression '/' name=ID block=Block;

LoopSelectHandler:
    'on' 'select' (action=ValueReference | '->' block=ActionBlock);

// A bare item constructor and a following statement block both begin with `Name {`.
// Collection roots therefore use the unambiguous iterable forms; parenthesize any
// broader expression before the block.
ForCollectionExpression infers Expression:
    '(' Expression ')' | ListLiteral | MemberAccessExpression | FunctionCallExpression
    | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | ValueReference;
