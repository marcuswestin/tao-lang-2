grammar TaoViews

import "./blocks"
import "./expressions"
import "./injections"
import "./terminals"

entry ViewsGrammarEntrypoint:
    UiDeclaration;

UiDeclaration:
    'ui' name=ID parameterList=ParameterList? block=Block;

type ViewDeclaration = UiDeclaration;

Render:
    'render' (injection=Injection | view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?);
