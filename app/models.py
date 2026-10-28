from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, Enum):
    CITIZEN = "citizen"
    ADMIN = "admin"


class ComplaintStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    # Retained for historical records from the existing application.
    REJECTED = "rejected"


class Priority(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.CITIZEN.value)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sms_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    profile_image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    complaints: Mapped[list["Complaint"]] = relationship(back_populates="user")


class Complaint(Base):
    __tablename__ = "complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50))
    priority: Mapped[str] = mapped_column(String(20), default=Priority.MEDIUM.value)
    status: Mapped[str] = mapped_column(String(30), default=ComplaintStatus.PENDING.value)
    department: Mapped[str] = mapped_column(String(100))
    image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    video_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_team: Mapped[str | None] = mapped_column(String(120), nullable=True)
    photo_source: Mapped[str | None] = mapped_column(String(30), nullable=True)
    photo_datetime_original: Mapped[str | None] = mapped_column(String(80), nullable=True)
    photo_create_date: Mapped[str | None] = mapped_column(String(80), nullable=True)
    photo_gps_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    photo_gps_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    photo_make: Mapped[str | None] = mapped_column(String(120), nullable=True)
    photo_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    device_gps_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    device_gps_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    user: Mapped["User"] = relationship(back_populates="complaints")
    status_history: Mapped[list["StatusHistory"]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan"
    )


class StatusHistory(Base):
    __tablename__ = "status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    complaint_id: Mapped[int] = mapped_column(ForeignKey("complaints.id"))
    status: Mapped[str] = mapped_column(String(30))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    complaint: Mapped["Complaint"] = relationship(back_populates="status_history")


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (UniqueConstraint("event_key", name="uq_notification_event_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    complaint_id: Mapped[int] = mapped_column(ForeignKey("complaints.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )




