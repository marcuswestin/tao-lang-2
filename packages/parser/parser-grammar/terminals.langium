grammar TaoTerminals

entry TerminalsGrammarEntrypoint:
    // Includes terminals consumed from imported grammar modules so Langium marks them reachable.
    value=(TS_CODE_BLOCK | INTERPOLATED_STRING_START | STRING_TEXT | STRING_END | INTERPOLATION_START | STRING | NUMBER | ID | USE_IMPORT_PATH | TagOrHexColor);

terminal TS_CODE_BLOCK: '```ts' -> '```';
terminal INTERPOLATED_STRING_START: /"/;
terminal STRING_TEXT: /([^"\\{]|\\.)+/;
terminal STRING_END: /\x22/;
terminal INTERPOLATION_START: /\{/;
terminal STRING: /"([^"\\{]|\\.)*"/;
// Decimals, so `1.5` lexes as one number while `1.ms` stays NUMBER '.' ID.
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal USE_IMPORT_PATH: /(@[a-zA-Z0-9._\-]+(\/[a-zA-Z0-9._\-]+)*)|(\.\/[a-zA-Z0-9._\-@\/]*)|(\.\.(\/[a-zA-Z0-9._\-@]+)*\/?)|([a-zA-Z.][a-zA-Z0-9._\-]*\/[a-zA-Z0-9._\-@\/]*)/;
terminal TagOrHexColor: /#[A-Za-z0-9_]+/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
