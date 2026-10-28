import asyncio
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from typing import Protocol

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import (
    MSG91_AUTH_KEY,
    MSG91_TEMPLATE_IN_PROGRESS,
    MSG91_TEMPLATE_NEW,
    MSG91_TEMPLATE_PENDING,
    MSG91_TEMPLATE_RESOLVED,
    SMS_MODE,
)
from app.database import SessionLocal
from app.models import Complaint, NotificationOutbox, User
from app.services.phone import normalize_indian_mobile

logger = logging.getLogger(__name__)
MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow"
MAX_ATTEMPTS = 5
REQUEST_TIMEOUT_SECONDS = 10
POLL_INTERVAL_SECONDS = 5


class SmsProvider(Protocol):
    def send(self, phone_number: str, template_id: str, complaint_id: int) -> str | None: ...


class Msg91Provider:
    def send(self, phone_number: str, template_id: str, complaint_id: int) -> str | None:
        return _send_msg91(phone_number, template_id, complaint_id)

MESSAGES = {
    "created": "Smart City Reporting: Your complaint #{id} has been registered successfully. Current status: Pending.",
    "pending": "Smart City Reporting: The status of your complaint #{id} has been updated to Pending.",
    "in_progress": "Smart City Reporting: Your complaint #{id} is now In Progress. We are working on your issue.",
    "resolved": "Smart City Reporting: Your complaint #{id} has been marked Resolved. Thank you for helping improve our city.",
}
TEMPLATES = {
    "created": MSG91_TEMPLATE_NEW,
    "pending": MSG91_TEMPLATE_PENDING,
    "in_progress": MSG91_TEMPLATE_IN_PROGRESS,
    "resolved": MSG91_TEMPLATE_RESOLVED,
}


def enqueue_notification(
    db: Session,
    complaint: Complaint,
    event_type: str,
    event_key: str | None = None,
) -> NotificationOutbox:
    if event_type not in MESSAGES:
        raise ValueError("Unsupported SMS notification event")
    event_key = event_key or f"complaint:{complaint.id}:{event_type}"
    existing = db.query(NotificationOutbox).filter_by(event_key=event_key).first()
    if existing:
        return existing
    notification = NotificationOutbox(
        event_key=event_key,
        event_type=event_type,
        complaint_id=complaint.id,
        user_id=complaint.user_id,
        status="queued",
    )
    db.add(notification)
    return notification


def message_for(notification: NotificationOutbox) -> str:
    return MESSAGES[notification.event_type].format(id=notification.complaint_id)


def _send_msg91(phone_number: str, template_id: str, complaint_id: int) -> str | None:
    if not MSG91_AUTH_KEY or not template_id:
        raise ValueError("SMS provider configuration is incomplete")
    body = json.dumps({
        "template_id": template_id,
        "recipients": [{"mobiles": phone_number, "VAR1": str(complaint_id)}],
    }).encode("utf-8")
    request = urllib.request.Request(
        MSG91_FLOW_URL,
        data=body,
        headers={
            "accept": "application/json",
            "authkey": MSG91_AUTH_KEY,
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError("SMS provider returned an HTTP error") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("SMS provider could not be reached") from exc
    if isinstance(result, dict) and str(result.get("type", "")).lower() == "error":
        raise RuntimeError("SMS provider rejected the request")
    message_id = result.get("message") if isinstance(result, dict) else None
    return str(message_id)[:120] if message_id else None


def dispatch_notification(notification_id: int, session_factory=SessionLocal) -> None:
    db = session_factory()
    try:
        claimed = db.query(NotificationOutbox).filter(
            NotificationOutbox.id == notification_id,
            NotificationOutbox.status == "queued",
        ).update(
            {
                NotificationOutbox.status: "processing",
                NotificationOutbox.attempts: NotificationOutbox.attempts + 1,
                NotificationOutbox.updated_at: datetime.utcnow(),
            },
            synchronize_session=False,
        )
        if claimed != 1:
            db.rollback()
            return
        db.commit()
        notification = db.get(NotificationOutbox, notification_id)

        user = db.get(User, notification.user_id)
        if user is None or not user.phone_number:
            notification.status = "skipped"
            notification.last_error = "No registered mobile number"
            db.commit()
            return
        if not user.sms_notifications_enabled:
            notification.status = "skipped"
            notification.last_error = "SMS consent is not enabled"
            db.commit()
            return

        try:
            phone_number = normalize_indian_mobile(user.phone_number)
        except ValueError:
            phone_number = None
        if not phone_number:
            notification.status = "skipped"
            notification.last_error = "Registered mobile number is invalid"
            db.commit()
            return

        mode = SMS_MODE
        if mode == "simulation":
            notification.status = "simulated"
            notification.last_error = None
            db.commit()
            logger.info(
                "SMS SIMULATION (not sent): event_id=%s complaint_id=%s message=%s",
                notification.id,
                notification.complaint_id,
                message_for(notification),
            )
            return
        if mode != "msg91":
            notification.status = "failed"
            notification.last_error = "Unsupported SMS_MODE"
            notification.next_attempt_at = None
            db.commit()
            return
        if not MSG91_AUTH_KEY or not TEMPLATES[notification.event_type]:
            notification.status = "failed"
            notification.last_error = "SMS provider configuration is incomplete"
            notification.next_attempt_at = None
            db.commit()
            return

        provider: SmsProvider = Msg91Provider()
        provider_id = provider.send(
            phone_number,
            TEMPLATES[notification.event_type],
            notification.complaint_id,
        )
        notification.status = "accepted"
        notification.provider_message_id = provider_id
        notification.last_error = None
        db.commit()
    except Exception as exc:
        db.rollback()
        notification = db.get(NotificationOutbox, notification_id)
        if notification is not None:
            notification.last_error = type(exc).__name__
            if notification.attempts >= MAX_ATTEMPTS:
                notification.status = "failed"
                notification.next_attempt_at = None
            else:
                notification.status = "queued"
                notification.next_attempt_at = datetime.utcnow() + timedelta(
                    seconds=min(60 * (2 ** max(notification.attempts - 1, 0)), 3600)
                )
            db.commit()
        logger.warning("SMS notification processing failed: event_id=%s error_type=%s", notification_id, type(exc).__name__)
    finally:
        db.close()


def process_due_notifications(session_factory=SessionLocal) -> None:
    db = session_factory()
    now = datetime.utcnow()
    try:
        stale_before = now - timedelta(minutes=10)
        db.query(NotificationOutbox).filter(
            NotificationOutbox.status == "processing",
            NotificationOutbox.updated_at < stale_before,
        ).update({NotificationOutbox.status: "queued"}, synchronize_session=False)
        db.commit()
        ids = [row.id for row in db.query(NotificationOutbox.id).filter(
            NotificationOutbox.status == "queued",
            or_(NotificationOutbox.next_attempt_at.is_(None), NotificationOutbox.next_attempt_at <= now),
        ).order_by(NotificationOutbox.created_at).limit(20).all()]
    finally:
        db.close()
    for notification_id in ids:
        dispatch_notification(notification_id, session_factory)


async def notification_worker(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(process_due_notifications)
        except Exception as exc:
            logger.warning("SMS outbox polling failed: error_type=%s", type(exc).__name__)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass
