import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy import inspect

from app.auth import hash_password
from app.config import UPLOAD_DIR
from app.upload_settings import PHOTO_MAX_BYTES, VIDEO_MAX_BYTES
from app.database import Base, SessionLocal, engine
from app.migrations import ensure_complaint_media_columns
from app.models import User, UserRole
from app.routes import admin, auth, chatbot, complaints, problem_analysis
from app.services.sms import notification_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.begin() as connection:
        if "phone_number" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN phone_number VARCHAR(20)"))
        if "sms_notifications_enabled" not in user_columns:
            connection.execute(text(
                "ALTER TABLE users ADD COLUMN sms_notifications_enabled BOOLEAN NOT NULL DEFAULT 0"
            ))
        if "profile_image_path" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN profile_image_path VARCHAR(500)"))
    complaint_columns = {column["name"] for column in inspect(engine).get_columns("complaints")}
    if "assigned_team" not in complaint_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE complaints ADD COLUMN assigned_team VARCHAR(120)"))
    ensure_complaint_media_columns(engine)
    complaint_metadata_columns = {column["name"] for column in inspect(engine).get_columns("complaints")}
    history_columns = {column["name"] for column in inspect(engine).get_columns("status_history")}
    with engine.begin() as connection:
        for name, sql_type in {
            "photo_source": "VARCHAR(30)", "photo_datetime_original": "VARCHAR(80)",
            "photo_create_date": "VARCHAR(80)", "photo_gps_latitude": "FLOAT",
            "photo_gps_longitude": "FLOAT", "photo_make": "VARCHAR(120)",
            "photo_model": "VARCHAR(120)", "device_gps_latitude": "FLOAT",
            "device_gps_longitude": "FLOAT",
        }.items():
            if name not in complaint_metadata_columns:
                connection.execute(text(f"ALTER TABLE complaints ADD COLUMN {name} {sql_type}"))
        for name, sql_type in {"event_type": "VARCHAR(40)", "actor_user_id": "INTEGER", "actor_name": "VARCHAR(100)"}.items():
            if name not in history_columns:
                connection.execute(text(f"ALTER TABLE status_history ADD COLUMN {name} {sql_type}"))
    db = SessionLocal()
    try:
        # Safe, idempotent migration of legacy workflow labels. Complaint rows
        # and status history are retained; the old labels become the current
        # three-step lifecycle labels.
        for table in ("complaints", "status_history"):
            db.execute(text(f"UPDATE {table} SET status = 'pending' WHERE status IN ('submitted', 'under_review')"))
        db.commit()
        admin_user = db.query(User).filter(User.email == "admin@smartcity.gov").first()
        if not admin_user:
            db.add(
                User(
                    name="System Admin",
                    email="admin@smartcity.gov",
                    password_hash=hash_password("admin123"),
                    role=UserRole.ADMIN.value,
                )
            )
            db.commit()
    finally:
        db.close()
    stop_event = asyncio.Event()
    worker_task = asyncio.create_task(notification_worker(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await worker_task


app = FastAPI(
    title="Smart City Issue Reporting System",
    description="AI-powered civic issue reporting with geospatial analysis",
    version="1.0.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def reject_oversized_complaint_request(request: Request, call_next):
    # UploadFile fields are spooled by Starlette before route validation. Reject an
    # oversized declared body before multipart parsing; per-file limits remain authoritative.
    if request.method == "POST" and request.url.path.rstrip("/") == "/api/complaints":
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit():
            request_limit = PHOTO_MAX_BYTES + VIDEO_MAX_BYTES + 1024 * 1024
            if int(content_length) > request_limit:
                return JSONResponse(status_code=413, content={"detail": {
                    "code": "complaint_upload_too_large",
                    "message": "The total evidence upload is too large. Keep photos under 5 MB and MP4 videos under 50 MB.",
                }})
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(auth.router)
app.include_router(complaints.router)
app.include_router(admin.router)
app.include_router(problem_analysis.router)
app.include_router(chatbot.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Smart City Issue Reporting System"}




