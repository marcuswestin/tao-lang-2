grammar TaoTerminals

entry TerminalsGrammarEntrypoint:
    value=(TS_CODE_BLOCK | STRING | ID);

terminal TS_CODE_BLOCK: '```ts' -> '```';
terminal STRING: /"([^"\\]|\\.)*"/;
terminal ID: /[_a-zA-Z][\w_]*/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
