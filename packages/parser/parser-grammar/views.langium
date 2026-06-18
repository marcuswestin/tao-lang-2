grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./layout"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration | LayoutDeclaration;

DeclarationVisibility returns string:
    'package' | 'project' | 'publish';

ViewDeclaration:
    visibility=DeclarationVisibility? 'view' name=ID parameterList=ParameterList? block=Block;

LayoutDeclaration:
    visibility=DeclarationVisibility? 'layout' name=ID parameterList=ParameterList? block=Block;

type RenderableDeclaration = ViewDeclaration | LayoutDeclaration;

RenderStatement:
    'render' (injection=Injection layoutClause=LayoutClause? | view=[RenderableDeclaration:ID] argumentList=ArgumentList? layoutClause=LayoutClause? block=Block?);

ViewRender:
    view=[RenderableDeclaration:ID] argumentList=ArgumentList? layoutClause=LayoutClause? block=Block?;

type Render = RenderStatement | ViewRender;
