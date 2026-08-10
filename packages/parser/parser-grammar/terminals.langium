grammar TaoTerminals

entry TerminalsGrammarEntrypoint:
    // Includes terminals consumed from imported grammar modules so Langium marks them reachable.
    value=(TS_CODE_BLOCK | STRING | NUMBER | ID | USE_IMPORT_PATH);

terminal TS_CODE_BLOCK: '```ts' -> '```';
terminal STRING: /"([^"\\]|\\.)*"/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal USE_IMPORT_PATH: /(@[a-zA-Z0-9._\-]+(\/[a-zA-Z0-9._\-]+)*)|(\.\/[a-zA-Z0-9._\-@\/]*)|(\.\.(\/[a-zA-Z0-9._\-@]+)*\/?)|([a-zA-Z.][a-zA-Z0-9._\-]*\/[a-zA-Z0-9._\-@\/]*)/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
