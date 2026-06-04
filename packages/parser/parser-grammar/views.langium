grammar TaoViews

import "./blocks"
import "./expressions"
import "./terminals"

entry ViewsGrammarEntrypoint:
    ViewDeclaration;

ViewDeclaration:
    'ui' name=ID parameterList=ParameterList? block=Block;

Render:
    'render' (injection=Injection | view=[ViewDeclaration:ID] argumentList=ArgumentList? block=Block?);

Injection:
    'inject' type='raw'? tsCodeBlock=TS_CODE_BLOCK;
