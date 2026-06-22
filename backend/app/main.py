"""WorkshopIQ FastAPI application entrypoint."""
import asyncio
import logging
import os
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    auth,
    backup,
    checkin,
    costing,
    customers,
    dashboard,
    final_inspection,
    jobs,
    ncr,
    reports,
    reviews,
    samba,
    settings as settings_api,
    templates,
    users,
)
from app.core.bootstrap import run_bootstrap
from app.core.config import settings
from app.services.samba_scheduler import scheduler_loop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("workshopiq")

# Short identifier for THIS running backend (container hostname). Surfaced on
# every API response as X-WIQ-Instance so a duplicate origin is easy to spot.
_INSTANCE_ID = os.environ.get("HOSTNAME") or socket.gethostname()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)
    await run_bootstrap()
    logger.info("Bootstrap complete")
    samba_task = asyncio.create_task(scheduler_loop())
    try:
        yield
    finally:
        samba_task.cancel()
        try:
            await samba_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_api_responses(request: Request, call_next):
    """Stop browsers / Android WebViews / Cloudflare from serving stale API data.

    Without this, a mobile client caches GET /api/jobs and keeps showing an
    old job count (e.g. 17 of 23) even after logging out and back in, because
    re-login doesn't clear the HTTP disk cache. We also send the Cloudflare /
    CDN-specific cache-control headers so the edge never caches API responses.

    The X-WIQ-Instance / X-WIQ-Worker headers identify which container + worker
    answered. If you curl an endpoint repeatedly and these flip between two
    different instance values, you have TWO origins serving the same hostname
    (e.g. a leftover cloudflared tunnel or an old stack) — that's what makes a
    job count flip between two fixed numbers.
    """
    response = await call_next(request)
    if request.url.path.startswith(settings.API_PREFIX):
        response.headers["Cache-Control"] = (
            "no-store, no-cache, must-revalidate, max-age=0, private"
        )
        response.headers["CDN-Cache-Control"] = "no-store"
        response.headers["Cloudflare-CDN-Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        response.headers["Vary"] = "Authorization"
        response.headers["X-WIQ-Instance"] = _INSTANCE_ID
        response.headers["X-WIQ-Worker"] = str(os.getpid())
    return response

for r in (auth, users, jobs, costing, customers, templates, dashboard, settings_api, checkin, reports, reviews, final_inspection, ncr, backup, samba):
    app.include_router(r.router, prefix=settings.API_PREFIX)


@app.get(f"{settings.API_PREFIX}/health", tags=["health"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION, "instance": _INSTANCE_ID}
