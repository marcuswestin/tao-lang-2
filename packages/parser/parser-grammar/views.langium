grammar TaoViews

import "./blocks"
import "./expressions"
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

Injection:
    'inject' tsCodeBlock=TS_CODE_BLOCK;
