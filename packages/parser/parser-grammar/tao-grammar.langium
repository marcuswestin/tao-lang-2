grammar TaoLang

import "./app"
import "./views"
import "./blocks"
import "./aliases"
import "./expressions"
import "./terminals"

entry TaoFile:
    statements+=Statement*;
