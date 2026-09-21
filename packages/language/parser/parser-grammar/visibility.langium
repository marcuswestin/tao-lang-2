grammar TaoVisibility

entry VisibilityGrammarEntrypoint:
    value=DeclarationVisibility;

DeclarationVisibility returns string:
    'file' | 'folder' | 'package' | 'workspace' | 'public';
