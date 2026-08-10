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
        | view=[RenderableDeclaration:ID] (layoutClause=LayoutClause block=Block? | argumentList=ArgumentList layoutClause=LayoutClause? block=Block? | block=Block?));

ViewRender:
    view=[RenderableDeclaration:ID] (layoutClause=LayoutClause block=Block? | argumentList=ArgumentList layoutClause=LayoutClause? block=Block? | block=Block?);

type Render = RenderStatement | ViewRender;

IfStatement:
    'if' condition=Expression thenBlock=Block ('else' elseBlock=Block)?;

ForStatement:
    'for' name=ID 'in' collection=Expression block=Block;
