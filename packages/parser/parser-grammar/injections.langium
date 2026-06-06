grammar TaoInjections

import "./expressions"
import "./terminals"

entry InjectionsGrammarEntrypoint:
    Injection;

Injection:
    'inject' argumentList=InjectionArgumentList? tsCodeBlock=TS_CODE_BLOCK;

InjectionArgumentList:
    arguments+=InjectionArgument (',' arguments+=InjectionArgument)*;

InjectionArgument:
    NamedInjectionArgument | ShorthandInjectionArgument;

NamedInjectionArgument:
    name=ID value=Expression;

ShorthandInjectionArgument:
    value=ValueReference;
