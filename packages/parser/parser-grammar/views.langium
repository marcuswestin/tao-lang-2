grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./layout"
import "./visibility"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration | LayoutDeclaration | UiDeclaration;

TagStatement:
    tag=TAG;

UiDeclaration:
    visibility=DeclarationVisibility? 'ui' name=ID parameterList=ParameterList? block=Block;

ViewDeclaration:
    visibility=DeclarationVisibility? 'view' name=ID parameterList=ParameterList? block=Block;

LayoutDeclaration:
    visibility=DeclarationVisibility? 'layout' name=ID parameterList=ParameterList? block=Block;

type RenderableDeclaration = ViewDeclaration | LayoutDeclaration;
type VisualDeclaration = RenderableDeclaration | UiDeclaration;

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

// A bare item constructor and a following statement block both begin with `Name {`.
// Collection roots therefore use the unambiguous iterable forms; parenthesize any
// broader expression before the block.
ForCollectionExpression infers Expression:
    '(' Expression ')' | ListLiteral | MemberAccessExpression | FunctionCallExpression
    | InterpolatedString | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | ValueReference;
