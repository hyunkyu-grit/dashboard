"""
Services layer: use-case orchestration.

Composes core/, engine/, and loaders/ into application use cases.
Route handlers delegate all computation to this layer; no business
logic lives in api/.

DEVIATION from the frozen source: it eagerly imported mtm_service and
pricing_service here as well. Neither is reachable from this deployment's
endpoints (simulate / market-data / credit-curve / positions), and that eager
import was the only thing dragging them — plus portfolio_service behind them —
into the closure. Importing market_data_service stays, because the monkeypatch
seam simulation/swap_inputs.py relies on resolves through this package.
"""

from . import market_data_service

__all__ = ["market_data_service"]
