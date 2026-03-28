"""Application entry point."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routes import chat, machines, operations, schedule, work_orders

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

# Create tables for any models that don't exist yet
Base.metadata.create_all(bind=engine)

# Incremental schema migrations (adds missing columns to existing tables)
try:
    from app.migrate_db import migrate
    migrate()
except Exception as exc:
    logging.getLogger(__name__).warning(
        "Migration error (non-fatal, app will still start): %s", exc
    )

app = FastAPI(
    title="Scheduler AI",
    description=(
        "Production-grade machine & work-order scheduler with an AI chat interface.\n\n"
        "Supported scheduling algorithms: EDD, SPT, FIFO, CRITICAL_RATIO."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to your frontend origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(machines.router,    prefix="/api/machines",     tags=["Machines"])
app.include_router(work_orders.router, prefix="/api/work-orders",  tags=["Work Orders"])
app.include_router(operations.router,  prefix="/api/operations",   tags=["Operations"])
app.include_router(schedule.router,    prefix="/api/schedule",     tags=["Schedule"])
app.include_router(chat.router,        prefix="/api/chat",         tags=["Chat"])


@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "service": "Scheduler AI", "version": "2.0.0"}


@app.get("/health", tags=["Health"])
def health():
    """Liveness probe endpoint for container orchestration."""
    return {"status": "healthy"}
