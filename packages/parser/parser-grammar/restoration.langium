grammar TaoRestoration

import "./terminals"

entry RestorationGrammarEntrypoint:
    RestorationPolicy;

RestorationPolicy:
    'Restore' mode=RestorationMode exclusions=RestorationExclusionBlock?;

RestorationMode returns string:
    'automatic' | 'fresh';

RestorationExclusionBlock:
    '{' 'Exclude' exclusions+=ID (',' exclusions+=ID)* '}';
