grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./expressions"
import "./injections"
import "./terminals"

entry TaoFile:
    statements+=Statement*;
