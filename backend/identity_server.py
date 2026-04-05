"""
Singra Vox ID – Standalone Server
===================================

This entry point runs the Singra Vox ID identity service as an independent
FastAPI application.  Use this when deploying the ID server separately from
any Singra Vox instance (recommended for production).

Usage:
    uvicorn identity_server:app --host 0.0.0.0 --port 8002

Environment:
    MONGO_URL           MongoDB connection string
    DB_NAME             Database name (default: singravox_id)
    SVID_ISSUER         Canonical URL (e.g. https://id.singravox.com)
    SVID_JWT_SECRET     JWT signing secret (MUST be set in production)
    SMTP_HOST           SMTP server for email delivery
    SMTP_PORT           SMTP port
    SMTP_USERNAME       SMTP username
    SMTP_PASSWORD       SMTP password / API key
    SMTP_FROM_EMAIL     Sender email address
    SMTP_FROM_NAME      Sender display name
    SMTP_USE_SSL        true/false
    CORS_ORIGINS        Comma-separated allowed origins
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

# Load environment from .env in the same directory or backend/.env
for env_path in [Path(__file__).parent / ".env", Path(__file__).parent / "backend" / ".env"]:
    if env_path.exists():
        load_dotenv(env_path)
        break

# ── Configuration ────────────────────────────────────────────────────────────
mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
db_name = os.environ.get("SVID_DB_NAME", os.environ.get("DB_NAME", "singravox"))
cors_origins = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]

# ── MongoDB ──────────────────────────────────────────────────────────────────
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# ── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="Singra Vox ID",
    description="Central identity provider for Singra Vox instances",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mount Identity Routes ────────────────────────────────────────────────────
from app.identity.routes import mount_identity_routes
mount_identity_routes(app, db)


@app.get("/health")
async def health():
    """Health check for load balancers and monitoring."""
    return {"status": "ok", "service": "singravox-id"}


@app.get("/")
async def root():
    return {
        "service": "Singra Vox ID",
        "version": "1.0.0",
        "docs": "/docs",
        "openid_configuration": "/api/id/.well-known/openid-configuration",
    }
