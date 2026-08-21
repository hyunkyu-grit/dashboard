"""Equation layer (Phase 2): paper-coefficient assembly, no estimation.

- base:    Coefficient provenance + BehavioralEquation / PACEquation
- loader:  appendix_d.yaml + slot->symbol RESOLUTION registry
- korea:   eq. 7-44 Korea block
- foreign: eq. 4-6 China/Japan/EU/EA + RW placeholder
- us:      QPM2008 small NK block (SOURCE_QPM2008)
- sync:    KR-US term premium channel (FREE_PARAM_SYNC)
"""

from bigfoot.equations.base import (  # noqa: F401
    BehavioralEquation,
    Coefficient,
    Equation,
    PACEquation,
    UnresolvedCoefficientError,
)
from bigfoot.equations.loader import (  # noqa: F401
    RESOLUTION,
    load_appendix_d,
    resolve,
)
