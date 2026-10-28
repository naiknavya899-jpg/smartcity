import asyncio
import io
import struct
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_admin_user
from app.config import UPLOAD_DIR
from app.models import Base, Complaint, NotificationOutbox, User
from app.routes import admin, complaints
from app.schemas import ComplaintUpdate


def make_test_mp4():
    def atom(kind, payload):
        return struct.pack(">I4s", len(payload) + 8, kind) + payload
    movie_header = bytearray(20)
    struct.pack_into(">I", movie_header, 12, 1000)
    struct.pack_into(">I", movie_header, 16, 5000)
    track_header = bytearray(84)
    struct.pack_into(">I", track_header, 76, 1280 << 16)
    struct.pack_into(">I", track_header, 80, 720 << 16)
    handler = bytearray(12)
    handler[8:12] = b"vide"
    track = atom(b"trak", atom(b"tkhd", bytes(track_header)) + atom(b"mdia", atom(b"hdlr", bytes(handler))))
    movie = atom(b"moov", atom(b"mvhd", bytes(movie_header)) + track)
    return atom(b"ftyp", b"isom\x00\x00\x00\x00isomiso2") + movie + atom(b"mdat", b"test video content")


class ComplaintFlowTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=engine)
        self.engine = engine
        self.db = self.session_factory()
        self.saved_media = []
        self.citizen = User(name="Citizen", email="citizen@example.test", password_hash="unused", role="citizen")
        self.other_citizen = User(name="Other", email="other@example.test", password_hash="unused", role="citizen")
        self.admin_user = User(name="Admin", email="admin@example.test", password_hash="unused", role="admin")
        self.db.add_all([self.citizen, self.other_citizen, self.admin_user])
        self.db.commit()
        self.db.refresh(self.citizen)
        self.db.refresh(self.other_citizen)
        self.db.refresh(self.admin_user)

    def tearDown(self):
        for filename in self.saved_media:
            (UPLOAD_DIR / filename).unlink(missing_ok=True)
        self.db.close()
        self.engine.dispose()

    def test_submission_and_real_status_changes_create_deduplicated_events(self):
        with self.assertRaises(HTTPException) as invalid_location:
            asyncio.run(complaints.create_complaint(
                title="Road pothole",
                description="A large pothole is blocking the road near the school",
                latitude=float("nan"),
                longitude=75.3,
                address=None,
                image=None,
                video=None,
                db=self.db,
                current_user=self.citizen,
            ))
        self.assertEqual(invalid_location.exception.status_code, 422)
        with self.assertRaises(HTTPException) as missing_address:
            asyncio.run(complaints.create_complaint(
                title="Road pothole", description="A large pothole is blocking the road near the school",
                latitude=12.9, longitude=75.3, address=None, image=None, video=None,
                db=self.db, current_user=self.citizen,
            ))
        self.assertEqual(missing_address.exception.detail["code"], "address_required")
        with self.assertRaises(HTTPException) as missing_photo:
            asyncio.run(complaints.create_complaint(
                title="Road pothole",
                description="A large pothole is blocking the road near the school",
                latitude=12.9,
                longitude=75.3,
                address="Main Street near school",
                image=None,
                video=None,
                db=self.db,
                current_user=self.citizen,
            ))
        self.assertEqual(missing_photo.exception.status_code, 422)
        self.assertEqual(missing_photo.exception.detail["code"], "photo_required")

        photo_data = io.BytesIO()
        Image.new("RGB", (640, 480), "blue").save(photo_data, format="PNG")
        photo_bytes = photo_data.getvalue()
        with self.assertRaises(HTTPException) as missing_video:
            asyncio.run(complaints.create_complaint(
                title="Road pothole", description="A large pothole is blocking the road near the school",
                latitude=12.9, longitude=75.3, address="Main Street near school",
                image=UploadFile(file=io.BytesIO(photo_bytes), filename="road.png", size=len(photo_bytes)),
                video=None, db=self.db, current_user=self.citizen,
            ))
        self.assertEqual(missing_video.exception.detail["code"], "video_required")
        with patch("app.routes.complaints.analyze_complaint", return_value={
            "category": "pothole",
            "priority": "medium",
            "department": "Roads & Infrastructure",
            "confidence": 0.8,
        }):
            created = asyncio.run(complaints.create_complaint(
                title="Road pothole",
                description="A large pothole is blocking the road near the school",
                latitude=12.9,
                longitude=75.3,
                address="Main Street near school",
                image=UploadFile(file=io.BytesIO(photo_bytes), filename="road.png", size=len(photo_bytes)),
                video=UploadFile(file=io.BytesIO(make_test_mp4()), filename="road.mp4"),
                db=self.db,
                current_user=self.citizen,
            ))
        self.saved_media.append(created.image_path)
        self.saved_media.append(created.video_path)

        self.assertEqual(created.status, "pending")
        self.assertEqual(created.user_id, self.citizen.id)
        self.assertFalse(hasattr(created, "admin_notes"))
        complaint = self.db.get(Complaint, created.id)
        complaint.admin_notes = "Existing private note is preserved"
        self.db.commit()

        admin.update_complaint(
            created.id, ComplaintUpdate(status="in_progress"), self.db, self.admin_user
        )
        admin.update_complaint(
            created.id, ComplaintUpdate(status="in_progress"), self.db, self.admin_user
        )
        admin.update_complaint(
            created.id, ComplaintUpdate(status="pending"), self.db, self.admin_user
        )
        admin.update_complaint(
            created.id, ComplaintUpdate(status="in_progress"), self.db, self.admin_user
        )
        admin.update_complaint(
            created.id, ComplaintUpdate(status="resolved"), self.db, self.admin_user
        )
        admin.update_complaint(
            created.id, ComplaintUpdate(status="resolved"), self.db, self.admin_user
        )

        self.db.expire_all()
        stored = self.db.get(Complaint, created.id)
        self.assertEqual(stored.status, "resolved")
        self.assertEqual(stored.admin_notes, "Existing private note is preserved")
        self.assertEqual(self.db.query(NotificationOutbox).count(), 5)
        public_view = complaints.get_my_complaints(self.db, self.citizen)[0]
        self.assertEqual(public_view.status, "resolved")
        self.assertFalse(hasattr(public_view, "admin_notes"))
        self.assertTrue(all(not hasattr(item, "note") for item in public_view.status_history))

    def test_admin_notes_and_assignments_are_private_to_admin(self):
        record = Complaint(
            user_id=self.citizen.id,
            title="Leaking pipe",
            description="Water is surfacing beside the road",
            category="water_leakage",
            department="Water",
            latitude=12.9,
            longitude=75.3,
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        response = admin.update_complaint(
            record.id,
            ComplaintUpdate(admin_notes="Inspect the meter chamber", assigned_team="North Zone Crew"),
            self.db,
            self.admin_user,
        )
        self.assertEqual(response.admin_notes, "Inspect the meter chamber")
        self.assertEqual(response.assigned_team, "North Zone Crew")
        self.assertTrue(any(item.note and "Team assigned by Admin" in item.note for item in response.status_history))
        self.assertTrue(any(item.note and "Inspect the meter chamber" in item.note for item in response.status_history))
        public = complaints.get_complaint(record.id, self.db, self.citizen)
        self.assertFalse(hasattr(public, "admin_notes"))
        self.assertFalse(hasattr(public, "assigned_team"))
        self.assertTrue(all(not hasattr(item, "note") for item in public.status_history))
        public = complaints.get_complaint(record.id, self.citizen, self.db) if False else None

    def test_streetlight_verification_actions_persist_status_and_admin_audit(self):
        record = Complaint(
            user_id=self.citizen.id,
            title="Streetlight not working",
            description="The streetlight remains dark after sunset near the crossing.",
            category="streetlight",
            department="Electrical & Lighting",
            latitude=12.9,
            longitude=75.3,
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        actions = [
            (ComplaintUpdate(verification_action="confirm_fault", status="confirmed_fault", event_note="Reviewed photo; fault needs municipal confirmation."), "confirmed_fault", "fault_confirmed"),
            (ComplaintUpdate(verification_action="request_inspection", status="field_inspection_required", assigned_team="Existing Electrical Team", event_note="Inspect the fixture and wiring."), "field_inspection_required", "inspection_requested"),
            (ComplaintUpdate(verification_action="request_evidence", status="more_evidence_required", event_note="Please provide a wider view of the fixture."), "more_evidence_required", "more_evidence_requested"),
            (ComplaintUpdate(verification_action="metadata_checked", event_note="Capture metadata reviewed."), "more_evidence_required", "metadata_checked"),
            (ComplaintUpdate(verification_action="visual_assessment", event_note="Inconclusive: fixture is not visible clearly."), "more_evidence_required", "visual_assessment"),
            (ComplaintUpdate(verification_action="reject", status="rejected", event_note="Duplicate report confirmed by existing record."), "rejected", "report_rejected"),
            (ComplaintUpdate(verification_action="mark_resolved", status="resolved", event_note="Repair evidence reviewed."), "resolved", "issue_resolved"),
        ]
        for payload, expected_status, expected_event in actions:
            response = admin.update_complaint(record.id, payload, self.db, self.admin_user)
            self.assertEqual(response.status, expected_status)
            event = response.status_history[-1]
            self.assertEqual(event.event_type, expected_event)
            self.assertEqual(event.actor_user_id, self.admin_user.id)
            self.assertEqual(event.actor_name, self.admin_user.name)
            self.assertTrue(event.note)

        self.db.expire_all()
        stored = self.db.get(Complaint, record.id)
        self.assertEqual(stored.status, "resolved")
        self.assertEqual(stored.assigned_team, "Existing Electrical Team")
        self.assertGreaterEqual(len(stored.status_history), len(actions))
    def test_invalid_status_and_cross_user_access_are_rejected(self):
        other_record = Complaint(
            user_id=self.other_citizen.id,
            title="Other issue",
            description="A private complaint belonging to another account",
            category="other",
            department="General Municipal Office",
            latitude=1,
            longitude=1,
        )
        self.db.add(other_record)
        self.db.commit()
        self.db.refresh(other_record)

        self.assertEqual(ComplaintUpdate.model_validate({"status": "rejected", "admin_notes": "Duplicate report"}).status, "rejected")
        with self.assertRaises(ValidationError):
            ComplaintUpdate.model_validate({"status": "rejected"})
        with self.assertRaises(ValidationError):
            ComplaintUpdate.model_validate({"priority": "urgent"})
        with self.assertRaises(HTTPException) as access_error:
            complaints.get_complaint(other_record.id, self.db, self.citizen)
        self.assertEqual(access_error.exception.status_code, 403)
        with self.assertRaises(HTTPException) as role_error:
            get_admin_user(self.citizen)
        self.assertEqual(role_error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()





