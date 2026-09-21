grammar TaoProject

import "./terminals"
import "./app"

entry ProjectGrammarEntrypoint:
    ProjectDeclaration;

ProjectDeclaration:
    'project' block=ProjectBlock;

ProjectBlock:
    '{' statements+=ProjectStatement* '}';

ProjectStatement:
    ProjectId | ProjectName | ProjectVersion | ProjectDefaultApp | ProjectRemote | ProjectLicense | ProjectRequires;

ProjectId:
    'id' value=STRING;

ProjectName:
    'name' value=STRING;

ProjectVersion:
    'version' value=STRING;

ProjectDefaultApp:
    word=ID app=[AppDeclaration:ID];

ProjectRemote:
    'remote' remote=ProjectRemoteValue;

ProjectRemoteValue returns string:
    'none';

ProjectLicense:
    'license' value=ID;

ProjectRequires:
    'requires' value=ID;
