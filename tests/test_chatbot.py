import unittest
import json
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Complaint, User
from app.routes.chatbot import send_chat_message
from app.schemas import ChatbotRequest, ChatbotResponse
from app.services import chatbot


class ChatbotTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.session_factory()
        self.user = User(name="Citizen", email="chat-citizen@example.test", password_hash="unused", role="citizen")
        self.other_user = User(name="Other", email="chat-other@example.test", password_hash="unused", role="citizen")
        self.db.add_all([self.user, self.other_user])
        self.db.flush()
        self.own_report = Complaint(
            user_id=self.user.id, title="Broken streetlight", description="Light is not working near the park.",
            category="streetlight", priority="medium", status="in_progress", department="Electrical",
            latitude=12.9, longitude=74.8,
        )
        self.other_report = Complaint(
            user_id=self.other_user.id, title="Other citizen report", description="Private report belonging to another user.",
            category="pothole", priority="low", status="resolved", department="Roads",
            latitude=12.9, longitude=74.8,
        )
        self.db.add_all([self.own_report, self.other_report])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_tracking_uses_only_the_signed_in_users_real_record(self):
        result = chatbot.reply_to_user(f"Track complaint #{self.own_report.id}", [], self.user.id, self.db)
        self.assertEqual(result["source"], "complaints")
        self.assertIn("In Progress", result["reply"])
        self.assertIn(self.own_report.title, result["reply"])

        other_result = chatbot.reply_to_user(f"Track complaint #{self.other_report.id}", [], self.user.id, self.db)
        self.assertIn("couldn’t find", other_result["reply"])
        self.assertNotIn(self.other_report.title, other_result["reply"])

    def test_missing_ai_key_returns_useful_honest_fallback(self):
        with patch.object(chatbot, "OPENAI_API_KEY", ""), patch.object(chatbot, "APP_ENV", "development"):
            result = chatbot.reply_to_user("Photo and GPS Help", [], self.user.id, self.db)
        self.assertTrue(result["configuration_required"])
        self.assertIn("OPENAI_API_KEY is missing", result["reply"])
        self.assertIn("backend/.env", result["reply"])
        self.assertIn("Take a photo", result["reply"])
        self.assertIn("location", result["reply"])

    def test_missing_ai_key_in_production_keeps_fallback_without_development_diagnostic(self):
        with patch.object(chatbot, "OPENAI_API_KEY", ""), patch.object(chatbot, "APP_ENV", "production"):
            result = chatbot.reply_to_user("Photo and GPS Help", [], self.user.id, self.db)
        self.assertFalse(result["configuration_required"])
        self.assertNotIn("OPENAI_API_KEY", result["reply"])
        self.assertIn("Take a photo", result["reply"])

    def test_chat_endpoint_calls_openai_and_returns_frontend_response_shape(self):
        mock_http_response = MagicMock()
        mock_http_response.__enter__.return_value.read.return_value = json.dumps(
            {"output_text": "Describe the dark pole, add its location and a photo if safe, then submit the report."}
        ).encode()
        with patch.object(chatbot, "OPENAI_API_KEY", "test-only-key"), patch.object(
            chatbot, "urlopen", return_value=mock_http_response
        ) as mock_urlopen:
            result = send_chat_message(
                ChatbotRequest(message="How do I report a streetlight problem?"),
                self.db,
                self.user,
            )

        self.assertEqual(result["source"], "ai")
        self.assertIn("dark pole", result["reply"])
        self.assertIn("configuration_required", result)
        self.assertIn("action_path", result)
        validated = ChatbotResponse.model_validate(result)
        self.assertEqual(validated.reply, result["reply"])
        request = mock_urlopen.call_args.args[0]
        sent_payload = json.loads(request.data.decode())
        self.assertEqual(sent_payload["input"][-1]["content"], "How do I report a streetlight problem?")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-key")

    def test_report_quick_option_returns_navigation_action_without_claiming_submission(self):
        with patch.object(chatbot, "OPENAI_API_KEY", ""):
            result = chatbot.reply_to_user("Report a Pothole", [], self.user.id, self.db)
        self.assertEqual(result["action_path"], "/report")
        self.assertNotIn("submitted successfully", result["reply"].casefold())

    def test_admin_accounts_cannot_use_the_citizen_chatbot_endpoint(self):
        admin_user = User(name="Admin", email="chat-admin@example.test", password_hash="unused", role="admin")
        self.db.add(admin_user)
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            send_chat_message(ChatbotRequest(message="Help"), self.db, admin_user)
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
