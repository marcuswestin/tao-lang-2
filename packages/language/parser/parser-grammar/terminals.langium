grammar TaoTerminals

entry TerminalsGrammarEntrypoint:
    // Includes terminals consumed from imported grammar modules so Langium marks them reachable.
    value=(TS_CODE_BLOCK | INTERPOLATED_STRING_START | STRING_TEXT | STRING_END | INTERPOLATION_START | STRING | SEMVER_VALUE | NUMBER | NPM_LOCATOR | NUMERIC_UNIT_ID | ID | MetadataName | USE_IMPORT_PATH | TagOrHexColor);

terminal TS_CODE_BLOCK: '```ts' -> '```';
terminal INTERPOLATED_STRING_START: /"/;
terminal STRING_TEXT: /([^"\\{]|\\.)+/;
terminal STRING_END: /\x22/;
terminal INTERPOLATION_START: /\{/;
terminal STRING: /"([^"\\{]|\\.)*"/;
// These must precede NUMBER and ID: the lexer otherwise splits 1.2.3 and npm:date-fns early.
terminal SEMVER_VALUE: /[\^~]?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?/;
terminal NPM_LOCATOR: /npm:[a-zA-Z0-9._\-@\/]+/;
// Decimals, so `1.5` lexes as one number while `1.ms` stays NUMBER '.' ID.
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
// Lowercase unit names remain ordinary identifiers through the token builder's ID category.
// The boundary prevents a mixed-case identifier from splitting after its lowercase prefix.
terminal NUMERIC_UNIT_ID: /[_a-z][_a-z0-9]*(?![\w])/;
terminal ID: /[_a-zA-Z][\w_]*/;
// Publication metadata words are still valid app and primitive-slot names.
MetadataName returns string:
    ID | 'id' | 'name' | 'version';
terminal USE_IMPORT_PATH: /(@(?:[a-zA-Z0-9._\-]+)?(?:\/[a-zA-Z0-9._\-]+)*)|(\.\/[a-zA-Z0-9._\-@\/]*)|(\.\.(\/[a-zA-Z0-9._\-@]+)*\/?)|([a-zA-Z.][a-zA-Z0-9._\-]*\/[a-zA-Z0-9._\-@\/]*)/;
terminal TagOrHexColor: /#[A-Za-z0-9_]+/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
