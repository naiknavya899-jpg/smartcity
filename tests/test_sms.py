import json
import unittest
from unittest.mock import Mock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Complaint, NotificationOutbox, User
from app.schemas import UserRegister
from app.services.phone import normalize_indian_mobile
from app.services import sms


class SmsOutboxTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=engine)
        db = self.session_factory()
        self.user = User(
            name="Test Citizen",
            email="citizen@example.test",
            password_hash="unused",
            role="citizen",
            phone_number="9606051732",
            sms_notifications_enabled=True,
        )
        db.add(self.user)
        db.flush()
        self.complaint = Complaint(
            user_id=self.user.id,
            title="Street issue",
            description="A reported street issue near the school",
            category="other",
            department="General Municipal Office",
            latitude=12.9,
            longitude=75.3,
        )
        db.add(self.complaint)
        db.flush()
        self.notification = sms.enqueue_notification(db, self.complaint, "created")
        db.commit()
        self.notification_id = self.notification.id
        self.user_id = self.user.id
        self.complaint_id = self.complaint.id
        db.close()

    def tearDown(self):
        self.session_factory.kw["bind"].dispose()

    def get_notification(self):
        db = self.session_factory()
        try:
            return db.get(NotificationOutbox, self.notification_id)
        finally:
            db.close()

    def test_indian_number_normalization(self):
        self.assertEqual(normalize_indian_mobile("9606051732"), "919606051732")
        self.assertEqual(normalize_indian_mobile("+91 96060 51732"), "919606051732")
        self.assertIsNone(normalize_indian_mobile("  "))
        with self.assertRaises(ValueError):
            normalize_indian_mobile("12345")
        registration = UserRegister.model_validate({
            "name": "Citizen",
            "email": "citizen@example.com",
            "password": "test-only-password",
            "phone_number": "+91 96060 51732",
            "sms_notifications_enabled": True,
        })
        self.assertEqual(registration.phone_number, "919606051732")

    def test_outbox_event_key_prevents_duplicate_creation(self):
        db = self.session_factory()
        try:
            complaint = db.get(Complaint, self.complaint_id)
            repeated = sms.enqueue_notification(db, complaint, "created")
            db.commit()
            self.assertEqual(repeated.id, self.notification_id)
            self.assertEqual(db.query(NotificationOutbox).count(), 1)
        finally:
            db.close()

    def test_simulation_is_recorded_without_sending(self):
        with patch.object(sms, "SMS_MODE", "simulation"), patch.object(
            sms, "_send_msg91", side_effect=AssertionError("simulation must not call provider")
        ):
            sms.dispatch_notification(self.notification_id, self.session_factory)
            sms.dispatch_notification(self.notification_id, self.session_factory)
        self.assertEqual(self.get_notification().status, "simulated")
        self.assertEqual(self.get_notification().attempts, 1)

    def test_msg91_acceptance_uses_registered_number_and_template(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"type":"success","message":"provider-ref"}'
        with patch.object(sms, "SMS_MODE", "msg91"), patch.object(
            sms, "MSG91_AUTH_KEY", "test-key"
        ), patch.dict(sms.TEMPLATES, {"created": "test-template"}), patch(
            "urllib.request.urlopen", return_value=response
        ) as urlopen:
            sms.dispatch_notification(self.notification_id, self.session_factory)
            sms.dispatch_notification(self.notification_id, self.session_factory)

        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["template_id"], "test-template")
        self.assertEqual(payload["recipients"][0]["mobiles"], "919606051732")
        self.assertEqual(payload["recipients"][0]["VAR1"], str(self.complaint_id))
        self.assertEqual(self.get_notification().status, "accepted")
        self.assertEqual(self.get_notification().provider_message_id, "provider-ref")
        self.assertEqual(urlopen.call_count, 1)

    def test_provider_failure_is_queued_for_retry_without_number_in_error(self):
        db = self.session_factory()
        db.get(Complaint, self.complaint_id).status = "in_progress"
        db.commit()
        db.close()
        with patch.object(sms, "SMS_MODE", "msg91"), patch.object(
            sms, "MSG91_AUTH_KEY", "test-key"
        ), patch.dict(sms.TEMPLATES, {"created": "test-template"}), patch.object(
            sms, "_send_msg91", side_effect=TimeoutError("network timed out")
        ):
            sms.dispatch_notification(self.notification_id, self.session_factory)
        notification = self.get_notification()
        self.assertEqual(notification.status, "queued")
        self.assertEqual(notification.attempts, 1)
        self.assertEqual(notification.last_error, "TimeoutError")
        self.assertNotIn("9606051732", notification.last_error)
        db = self.session_factory()
        try:
            self.assertEqual(db.get(Complaint, self.complaint_id).status, "in_progress")
        finally:
            db.close()

    def test_sms_requires_explicit_consent(self):
        db = self.session_factory()
        user = db.get(User, self.user_id)
        user.sms_notifications_enabled = False
        db.commit()
        db.close()
        with patch.object(sms, "SMS_MODE", "msg91"), patch.object(
            sms, "_send_msg91", side_effect=AssertionError("consent is required")
        ):
            sms.dispatch_notification(self.notification_id, self.session_factory)
        self.assertEqual(self.get_notification().status, "skipped")


if __name__ == "__main__":
    unittest.main()
