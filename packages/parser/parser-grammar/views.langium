grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
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
    'render' (injection=Injection | view=[RenderableDeclaration:ID] argumentList=ArgumentList? block=Block?);

ViewRender:
    view=[RenderableDeclaration:ID] argumentList=ArgumentList? block=Block?;

type Render = RenderStatement | ViewRender;
