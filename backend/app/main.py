"""WorkshopIQ FastAPI application entrypoint."""
import asyncio
import logging
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
    """Stop browsers / Android WebViews from serving stale API data.

    Without this, a mobile client caches GET /api/jobs and keeps showing an
    old job count (e.g. 17 of 23) even after logging out and back in, because
    re-login doesn't clear the HTTP disk cache. Marking API responses
    no-store forces every request to hit the server.
    """
    response = await call_next(request)
    if request.url.path.startswith(settings.API_PREFIX):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

for r in (auth, users, jobs, costing, customers, templates, dashboard, settings_api, checkin, reports, reviews, final_inspection, ncr, backup, samba):
    app.include_router(r.router, prefix=settings.API_PREFIX)


@app.get(f"{settings.API_PREFIX}/health", tags=["health"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
