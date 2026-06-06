grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./terminals"

entry ViewsGrammarEntrypoint:
    UiDeclaration | LayoutDeclaration;

UiDeclaration:
    'ui' name=ID parameterList=ParameterList? block=Block;

LayoutDeclaration:
    'layout' name=ID parameterList=ParameterList? block=Block;

type ViewDeclaration = UiDeclaration | LayoutDeclaration;

RenderStatement:
    'render' (injection=Injection | view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?);

ViewRender:
    view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?;

type Render = RenderStatement | ViewRender;
