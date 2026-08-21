"""Data layer: ECOS (Bank of Korea) and FRED loaders with csv caching."""

from bigfoot.data.ecos import fetch_ecos, korea_core_dataset  # noqa: F401
from bigfoot.data.fred import fetch_fred  # noqa: F401
