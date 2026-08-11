grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./layout"
import "./visibility"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration | LayoutDeclaration;

ViewDeclaration:
    visibility=DeclarationVisibility? 'view' name=ID parameterList=ParameterList? block=Block;

LayoutDeclaration:
    visibility=DeclarationVisibility? 'layout' name=ID parameterList=ParameterList? block=Block;

type RenderableDeclaration = ViewDeclaration | LayoutDeclaration;

RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause?
        | view=[RenderableDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?);

ViewRender:
    view=[RenderableDeclaration:ID] '(' argumentList=ArgumentList? ')' layoutClause=LayoutClause? block=Block?;

type Render = RenderStatement | ViewRender;

// `otherwise` makes every render conditional total and terminates the branch list unambiguously.
WhenRenderStatement:
    'when' branches+=WhenRenderBranch+ otherwise=WhenRenderOtherwise;

WhenRenderBranch:
    condition=OrExpression '->' block=Block;

WhenRenderOtherwise:
    'otherwise' '->' block=Block;

ForStatement:
    'for' name=ID 'in' collection=ForCollectionExpression block=Block;

// A bare item constructor and a following statement block both begin with `Name {`.
// Collection roots therefore use the unambiguous iterable forms; parenthesize any
// broader expression before the block.
ForCollectionExpression infers Expression:
    '(' Expression ')' | ListLiteral | MemberAccessExpression | FunctionCallExpression
    | StringLiteral | NumberLiteral | BooleanLiteral | NoneLiteral | ValueReference;
