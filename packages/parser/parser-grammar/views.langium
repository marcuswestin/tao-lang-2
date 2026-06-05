grammar TaoViews

import "./blocks"
import "./expressions"
import "./terminals"

entry ViewsGrammarEntrypoint:
    UiDeclaration;

UiDeclaration:
    'ui' name=ID parameterList=ParameterList? block=Block;

type ViewDeclaration = UiDeclaration;

Render:
    'render' (injection=Injection | view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?);

Injection:
    'inject' tsCodeBlock=TS_CODE_BLOCK;
