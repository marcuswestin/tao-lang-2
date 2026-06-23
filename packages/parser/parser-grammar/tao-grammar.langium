grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./expressions"
import "./injections"
import "./project"
import "./tests"
import "./terminals"

entry TaoFile:
    statements+=Statement*;
