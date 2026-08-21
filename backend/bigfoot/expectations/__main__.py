# -*- coding: utf-8 -*-
"""python -m bigfoot.expectations — build the Korea engine, run the phase-1
test suite, and write output/expectations_summary.json (numbers only)."""
import json
import sys
from pathlib import Path

import pytest

from bigfoot.expectations import build_korea_engine

ROOT = Path(__file__).resolve().parents[2]


class _Counter:
    def __init__(self):
        self.passed = 0
        self.failed = 0

    def pytest_runtest_logreport(self, report):
        if report.when == "call":
            if report.passed:
                self.passed += 1
            elif report.failed:
                self.failed += 1


def main() -> None:
    engine = build_korea_engine(lags=2)
    counter = _Counter()
    rc = pytest.main(["-q", str(ROOT / "tests" / "test_expectations.py")],
                     plugins=[counter])
    summary = engine.summary(tests_passed=counter.passed)
    js = json.dumps(summary, indent=2)
    (ROOT / "output").mkdir(exist_ok=True)
    (ROOT / "output" / "expectations_summary.json").write_text(js, encoding="utf-8")
    print(f"\n=== expectations_summary.json ===\n{js}")
    if counter.failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
