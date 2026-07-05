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
    inspection_report,
    jobs,
    ncr,
    reports,
    reviews,
    samba,
    settings as settings_api,
    templates,
    training,
    users,
)
from app.core.bootstrap import run_bootstrap
from app.core.config import settings
from app.core.security import decode_token
from app.services.maintenance import MAINTENANCE_MESSAGE, is_maintenance_on
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


# ---------------- Maintenance mode ----------------
# When the admin flips "maintenance_mode" on in Settings, every API request
# from anyone who is NOT an administrator is refused with a 503 and a friendly
# message. Admins keep full access so they can work and turn it back off.
_MAINTENANCE_EXEMPT_PATHS = {
    f"{settings.API_PREFIX}/auth/login",  # admins must still be able to sign in
    f"{settings.API_PREFIX}/health",
}

_MAINTENANCE_HTML = f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Under maintenance</title>
<style>
  body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0e16;
       color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
  .card{{max-width:420px;margin:16px;padding:32px;border:1px solid rgba(148,163,184,.18);
        border-radius:16px;background:#0c1322;text-align:center}}
  h1{{font-size:20px;margin:0 0 12px}} p{{color:#94a3b8;line-height:1.6;margin:0}}
  .dot{{font-size:34px;margin-bottom:10px}}
</style></head><body><div class="card"><div class="dot">🛠️</div>
<h1>Server under maintenance</h1><p>{MAINTENANCE_MESSAGE}</p>
</div></body></html>"""


def _is_admin_request(request: Request) -> bool:
    """True if the request carries a valid administrator token (header or ?token=)."""
    raw = None
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        raw = auth[7:].strip()
    if not raw:
        raw = request.query_params.get("token")
    if not raw:
        return False
    payload = decode_token(raw)
    return bool(payload) and payload.get("role") == "administrator"


@app.middleware("http")
async def maintenance_gate(request: Request, call_next):
    path = request.url.path
    if (
        request.method == "OPTIONS"
        or not path.startswith(settings.API_PREFIX)
        or path in _MAINTENANCE_EXEMPT_PATHS
    ):
        return await call_next(request)
    if not await is_maintenance_on():
        return await call_next(request)
    if _is_admin_request(request):
        return await call_next(request)
    # Non-admin during maintenance. Browser navigations (e.g. the public
    # inspection-report form or a document link) get a small HTML page;
    # everything else gets JSON the frontend recognises.
    from fastapi.responses import HTMLResponse, JSONResponse

    accept = request.headers.get("accept", "")
    if request.method == "GET" and "text/html" in accept:
        return HTMLResponse(_MAINTENANCE_HTML, status_code=503)
    return JSONResponse(
        status_code=503,
        content={"detail": MAINTENANCE_MESSAGE, "maintenance": True},
    )

for r in (auth, users, jobs, costing, customers, templates, dashboard, settings_api, checkin, reports, reviews, final_inspection, ncr, backup, samba, inspection_report, training):
    app.include_router(r.router, prefix=settings.API_PREFIX)


@app.get(f"{settings.API_PREFIX}/health", tags=["health"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION, "instance": _INSTANCE_ID}
