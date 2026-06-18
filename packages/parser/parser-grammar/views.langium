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
