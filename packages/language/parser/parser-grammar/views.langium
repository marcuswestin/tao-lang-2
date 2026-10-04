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

// A view may exclude entity-default verbs from this occurrence's surface. The command remains in
// the catalog and may still be promoted explicitly through `Commands { ... }`.
ViewCommandExclusion:
    'hide' commands+=[CommandDeclaration:ID] (',' commands+=[CommandDeclaration:ID])*;

// The one renderable declaration kind. A view either declares its own parameters and body —
// optionally promising a typed answer with `responds` — or passes through to a package member:
// `public view Button = native.Button`. The alias publishes the target under this name; its
// interface is the target's. Every other capability is inferred from the body: a view accepts
// caller content iff it places `@@content`, and offers named render slots iff it declares them.
// A foreign view declares the same interface in its head because there is no Tao body to infer:
// `view Native(Value text) accepts content slots @header from ./Native.tsx`.
//
// `scene` is the same declaration with one added fact a body cannot state: it is presented, never
// composed. That is why it is a keyword here rather than a separate rule — a scene IS a view, as
// the Prelude's `scene is view` says, so everything that accepts a view accepts a scene and only
// the render site turns one away.
// The header clause is the declaration's public style surface: its defaults, which a caller's
// clause overrides, applied to the occurrence root of every render branch. What a render inside
// the body sets stays private.
ViewDeclaration:
    visibility=DeclarationVisibility? (scene?='scene' | 'view') name=ID
    (parameterList=ParameterList ('responds' response=[TypeDeclaration:ID])? layoutClause=LayoutClause?
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

// A render site names a view declaration, a nav declaration, or a parameter of the owning view whose
// type is `view`, `scene`, or `nav`. `nav is scene is view`, so everything that renders a view renders a
// nav: a shell is ordinary layout holding its navigator, and a nav-typed parameter is how one shell
// serves every configured navigator. A nav or a parameter renders as the value it was bound to, so it
// takes no arguments, content, or events of its own; the validator diagnoses those at the render site.
type RenderTarget = ViewDeclaration | NavDeclaration | ParameterDeclaration;

RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause?
        | view=[RenderTarget:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?);

ViewRender:
    view=[RenderTarget:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?;

EventHandler:
    'on' event=EventName (action=ValueReference | '->' payload=CasePayload? block=ActionBlock);

EventName returns string:
    'press' | 'change' | 'submit';

type Render = RenderStatement | ViewRender;

// `otherwise` makes every subject render conditional total and terminates the branch list unambiguously.
WhenRenderStatement:
    'when' (subject=SubjectExpression
      ('{' branches+=WhenRenderBranch* otherwise=WhenRenderOtherwise '}'
       | branches+=BarWhenRenderBranch* otherwise=BarWhenRenderOtherwise)
      | branches+=PredicateWhenRenderBranch* otherwise=BarWhenRenderOtherwise);

WhenRenderBranch:
    case=SubjectCaseName '->' payload=CasePayload? block=(Block | AtomicRenderBlock);

BarWhenRenderBranch infers WhenRenderBranch:
    barSyntax?='|' case=SubjectCaseName '->' payload=CasePayload? block=(Block | AtomicRenderBlock);

PredicateWhenRenderBranch infers WhenRenderBranch:
    barSyntax?='|' condition=OrExpression '->' block=(Block | AtomicRenderBlock);

WhenRenderOtherwise:
    'otherwise' '->' block=(Block | AtomicRenderBlock);

BarWhenRenderOtherwise infers WhenRenderOtherwise:
    barSyntax?='|' 'otherwise' '->' block=(Block | AtomicRenderBlock);

// A bare arm owns exactly one render or terminal match; a statement sequence requires braces.
AtomicRenderBlock returns Block:
    statements+=(ViewRender | RenderStatement | WhenRenderStatement);

IfRenderStatement:
    'if' condition=Expression block=Block;

// A render guard with no cases sends every exceptional case of its subject to the read net; one
// with cases sends the exceptional cases it does not name.
//
// The bare form is its own alternative rather than an optional tail: the parser decides an optional
// that ends its rule from the next token alone, and the render a bare guard protects begins with a
// name exactly as a declared case does. As alternatives the choice sees past that name.
GuardRenderStatement:
    'guard' subject=SubjectExpression (caseBlock=GuardRenderCaseBlock | single=GuardRenderSingleBranch)
    | 'guard' subject=SubjectExpression;

// A single declared case is a name, like the render that follows a bare guard, so it needs its arrow
// or handler to be told apart.
GuardRenderSingleBranch infers GuardRenderBranch:
    case=BuiltInSubjectCaseName ('->' payload=CasePayload?)? block=Block?
    | case=ID ('->' payload=CasePayload? block=Block? | block=Block);

// An empty case block parses so the validator can say what to write instead: a bare guard.
GuardRenderCaseBlock:
    '{' branches+=GuardRenderBranch* '}';

GuardRenderBranch:
    case=SubjectCaseName ('->' payload=CasePayload?)? block=Block?;

// An app's read net replaces the runtime's exceptional read cases one case at a time.
AppGuardStatement:
    'guard' '{' branches+=AppGuardBranch+ '}';

// Keep the old spelling parseable so the validator can give a migration diagnostic.
GuardDefaultStatement:
    'guard' 'default' '{' branches+=GuardDefaultBranch+ '}';

AppGuardBranch:
    case=SubjectCaseName '->' (render=ViewRender | payload=CasePayload? block=Block);

GuardDefaultBranch:
    case=SubjectCaseName '->' (render=ViewRender | payload=CasePayload? block=Block);

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
