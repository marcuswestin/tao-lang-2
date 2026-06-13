grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./terminals"

entry ViewsGrammarEntrypoint:
    UiDeclaration | LayoutDeclaration;

DeclarationVisibility returns string:
    'package' | 'project' | 'publish';

UiDeclaration:
    visibility=DeclarationVisibility? 'ui' name=ID parameterList=ParameterList? block=Block;

LayoutDeclaration:
    visibility=DeclarationVisibility? 'layout' name=ID parameterList=ParameterList? block=Block;

type ViewDeclaration = UiDeclaration | LayoutDeclaration;

RenderStatement:
    'render' (injection=Injection | view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?);

ViewRender:
    view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?;

type Render = RenderStatement | ViewRender;
