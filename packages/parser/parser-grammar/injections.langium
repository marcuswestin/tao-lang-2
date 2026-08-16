grammar TaoInjections

import "./expressions"
import "./terminals"

entry InjectionsGrammarEntrypoint:
    Injection | TypedInjectionExpression;

Injection:
    'inject' argumentList=InjectionArgumentList? tsCodeBlock=TS_CODE_BLOCK;

TypedInjectionExpression:
    'inject' type=TypeReference argumentList=InjectionArgumentList? tsCodeBlock=TS_CODE_BLOCK;

InjectionArgumentList:
    arguments+=InjectionArgument (',' arguments+=InjectionArgument)*;

InjectionArgument:
    NamedInjectionArgument | ShorthandInjectionArgument;

NamedInjectionArgument:
    name=ID (value=Expression | ambient=RenderAmbientChannel);

ShorthandInjectionArgument:
    value=ValueReference;

// These channels are parsed broadly enough for validators to report context-specific placement.
// Only render injections may consume them, and only layouts/frames may consume caller content.
RenderAmbientChannel:
    channel=('@@content' | '@@layout' | '@@tag');
