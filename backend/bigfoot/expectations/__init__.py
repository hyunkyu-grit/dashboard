"""Expectations engine — satellite VAR with shifting endpoints (Appendix A)."""

from bigfoot.expectations.engine import (  # noqa: F401
    AugmentedVAR,
    ECSatelliteVAR,
    NonStationaryError,
    SatelliteVAR,
    pac_G,
    recover_alphas,
)


def build_korea_engine(lags: int = 2, form: str = "dev"):
    """Build the v1 Korea engine from ECOS data (2000Q1-latest).

    form: "dev" (Phase-1 deviations VAR) or "a1_ec" (FORM_A1_EC — the
    photographed (A.1) explicit error-correction form with free A0).
    """
    from bigfoot.data.ecos import korea_core_dataset
    core, r_trend = korea_core_dataset("2000Q1")
    cls = {"dev": SatelliteVAR, "a1_ec": ECSatelliteVAR}[form]
    return cls(core, lags=lags, pi_endpoint=2.0, gap_endpoint=0.0,
               r_endpoint=r_trend)
