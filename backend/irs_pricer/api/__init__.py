"""IRS Pricer HTTP API package: routers only.

This used to export a FastAPI app (`from .app import app`) because the
simulation was its own service on :8200. It is not one any more — its routers
are registered on braveworld's app in `app/main.py`, which is the single
uvicorn entry point (`app.main:app`).

The export is gone rather than merely unused, and `api/app.py` is deleted:
`from .routers import simulate` imports this package first, so leaving the old
line here would have built a SECOND FastAPI app — with its own middleware
stack and its own `/api/health` — every time a router was imported. The
middleware classes and exception handlers that lived in api/app.py moved to
app/main.py verbatim; the lifespan curve_cache install moved with them.
"""
