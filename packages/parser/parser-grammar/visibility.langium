grammar TaoVisibility

entry VisibilityGrammarEntrypoint:
    value=DeclarationVisibility;

DeclarationVisibility returns string:
    'file' | 'package' | 'workspace' | 'public';
