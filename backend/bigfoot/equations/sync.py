# -*- coding: utf-8 -*-
"""KR-US term premium sync channel.

    tp_kr_t = beta_sync · tp_us_t

FREE_PARAM_SYNC: the elasticity is UNPUBLISHED in BOK WP 2025-3. beta_sync
defaults to 0.5 as a free parameter; Phase 3 pins it against the paper's
US-shock IRF anchor, after which that anchor leaves the validation set.
"""
from bigfoot.equations.base import Equation

FLAGS = ("FREE_PARAM_SYNC",)
DEFAULT_BETA_SYNC = 0.5


class TermPremiumSync(Equation):
    eq_no = "sync (unnumbered)"
    flags = FLAGS

    def __init__(self, beta_sync: float = DEFAULT_BETA_SYNC):
        super().__init__("tp_sync")
        self.beta_sync = beta_sync

    def kr_term_premium(self, us_term_premium: float) -> float:
        return self.beta_sync * us_term_premium

    def residual(self, tp_kr, tp_us):
        return tp_kr - self.kr_term_premium(tp_us)
