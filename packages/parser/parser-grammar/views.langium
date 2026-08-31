grammar TaoViews

import "./blocks"
import "./imports"
import "./expressions"
import "./injections"
import "./layout"
import "./visibility"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration;

TagStatement:
    tag=TagOrHexColor;

// The one renderable declaration kind. A view either declares its own parameters and body —
// optionally promising a typed answer with `responds` — or passes through to a package member:
// `public view Button = native.Button`. The alias publishes the target under this name; its
// interface is the target's. Every other capability is inferred from the body: a view accepts
// caller content iff it places `@@content`, and offers named render slots iff it declares them.
// A foreign view declares the same interface in its head because there is no Tao body to infer:
// `view Native(Value text) accepts content slots @header from ./Native.tsx`.
ViewDeclaration:
    visibility=DeclarationVisibility? 'view' name=ID
    (parameterList=ParameterList ('responds' response=[TypeDeclaration:ID])?
        (block=ViewBlock | foreign=ForeignViewImplementation)
        | '=' aliasTarget=PackageMemberReference);

ForeignViewImplementation:
    // Parse `content` as an ID and validate its spelling so the canonical layout word remains an ID
    // everywhere else rather than becoming a global lexer keyword.
    (accepts?='accepts' content=ID? ('slots' slots+=ForeignViewSlotDeclaration (',' slots+=ForeignViewSlotDeclaration)*)?)?
    'from' path=USE_IMPORT_PATH;

ForeignViewSlotDeclaration:
    name=USE_IMPORT_PATH;

// The source is context-sensitive here: bare supplied slots belong only to declaration bodies,
// while nested render blocks retain the ordinary statement grammar. Returning Block preserves the
// shared AST utilities and compiler boundary.
ViewBlock returns Block:
    '{' statements+=ViewStatement* '}';

// Views own optional, single-fill visual holes. A use without a render value places the slot in
// the declaring view's implementation; a use with a render value fills that slot at one call site.
RenderSlotDeclaration:
    name=USE_IMPORT_PATH '=' 'empty';

type RenderSlotContract = RenderSlotDeclaration | ForeignViewSlotDeclaration;

RenderSlotUse:
    slot=[RenderSlotContract:USE_IMPORT_PATH] render=ViewRender?;

// A content-accepting view places its opaque unnamed caller content explicitly in its render tree.
CallerContentStatement:
    {infer CallerContentStatement} '@@content';

RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause?
        | view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?);

ViewRender:
    view=[ViewDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?;

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
