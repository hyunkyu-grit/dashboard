# backend/research — q1 lane

Research-only. **Nothing under `backend/app/` may import from here**
(`tests/test_no_app_imports_research.py` enforces it).

Everything here reads real data through the existing data-access path.
Synthetic data is permitted **only** under `tests/` and only in files named
`synthetic_*`.

## ⚠ `research/calendar/` shadows a stdlib module name

`app/engine_port.py:127` and `app/forwards.py:19` both do `import calendar`
(stdlib). `research/calendar/` is only ever reachable as `research.calendar`,
because the directory that ends up on `sys.path` is `backend/` — never
`backend/research/`. Checked, and the full suite passes.

But it is one misplaced script away from breaking: put a `.py` file directly in
`backend/research/` and run it, and `sys.path[0]` becomes `backend/research/`,
at which point `import calendar` finds this package instead of the standard
library. **Do not add scripts at the top level of `research/`** — keep them in
subpackages, as everything here already is. Renaming this directory would remove
the hazard outright and is the better fix if this tree grows.

## Third-party pattern attribution
- The long-format risk ladder and the tenor-days ordering in `ladder/` are
  adapted from ideas in Goldman Sachs' `gs-quant` (Apache-2.0). No gs-quant
  code is vendored and gs-quant is not a dependency of this repo — it pins
  `numpy<2.4` while this application runs numpy 2.5.1.
