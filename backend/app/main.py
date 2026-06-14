"""WorkshopIQ FastAPI application entrypoint."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    auth,
    backup,
    checkin,
    dashboard,
    final_inspection,
    jobs,
    ncr,
    reports,
    reviews,
    settings as settings_api,
    templates,
    users,
)
from app.core.bootstrap import run_bootstrap
from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("workshopiq")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)
    await run_bootstrap()
    logger.info("Bootstrap complete")
    yield


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

for r in (auth, users, jobs, templates, dashboard, settings_api, checkin, reports, reviews, final_inspection, ncr, backup):
    app.include_router(r.router, prefix=settings.API_PREFIX)


@app.get(f"{settings.API_PREFIX}/health", tags=["health"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
