grammar TaoVisibility

entry VisibilityGrammarEntrypoint:
    value=DeclarationVisibility;

DeclarationVisibility returns string:
    'package' | 'project' | 'publish';
