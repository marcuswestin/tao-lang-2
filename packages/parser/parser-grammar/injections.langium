grammar TaoInjections

import "./expressions"
import "./terminals"

entry InjectionsGrammarEntrypoint:
    Injection;

// `render inject` is the view authoring mode: a visual whose implementation Tao does not own. Every
// other reach into TypeScript is the expression-position `from` operator (Decisions §15).
Injection:
    'inject' argumentList=InjectionArgumentList? tsCodeBlock=TS_CODE_BLOCK;

InjectionArgumentList:
    arguments+=InjectionArgument (',' arguments+=InjectionArgument)*;

InjectionArgument:
    NamedInjectionArgument | ShorthandInjectionArgument;

NamedInjectionArgument:
    name=ID (value=Expression | ambient=RenderAmbientChannel);

ShorthandInjectionArgument:
    value=ValueReference;

// These channels are parsed broadly enough for validators to report context-specific placement.
// Only render injections may consume them; naming `@@content` is the placement that makes the
// owning view content-accepting.
RenderAmbientChannel:
    channel=('@@content' | '@@layout' | '@@tag');
