from datetime import date
import os
import unittest
from unittest.mock import patch

from app.services import gee_service, water_leak_analysis


class EarthEngineDiagnosticsTests(unittest.TestCase):
    def test_google_api_proxy_fallback_preserves_existing_no_proxy_hosts(self):
        environment = {"HTTPS_PROXY": "configured-proxy", "NO_PROXY": "localhost", "no_proxy": "127.0.0.1"}
        with patch.dict(os.environ, environment, clear=True):
            self.assertTrue(gee_service._bypass_proxy_for_google_apis())
            upper = os.environ["NO_PROXY"].split(",")
            lower = os.environ["no_proxy"].split(",")
        self.assertIn("localhost", upper)
        self.assertIn("127.0.0.1", lower)
        for host in gee_service._GOOGLE_API_NO_PROXY_HOSTS:
            self.assertIn(host, upper)
            self.assertIn(host, lower)

    def test_google_api_proxy_fallback_is_not_applied_without_a_proxy(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(gee_service._bypass_proxy_for_google_apis())

    def test_network_failure_is_reported_as_network_error(self):
        error = gee_service._diagnose_gee_error(ConnectionError("connection refused"), "initialization")
        self.assertEqual(error.code, "network_error")
        self.assertIn("network access", str(error))

    def test_authentication_failure_does_not_echo_sensitive_error_text(self):
        error = gee_service._diagnose_gee_error(Exception("invalid_grant private key contents"), "initialization")
        self.assertEqual(error.code, "authentication_error")
        self.assertNotIn("private key contents", str(error))

    def test_cloud_project_configuration_errors_are_distinguished(self):
        cases = (
            ("Project is not registered for Earth Engine", "project_not_registered"),
            ("Earth Engine API has not been used in project", "earth_engine_api_disabled"),
            ("Permission denied for this project", "permission_denied"),
        )
        for message, expected_code in cases:
            with self.subTest(expected_code=expected_code):
                self.assertEqual(gee_service._diagnose_gee_error(Exception(message), "initialization").code, expected_code)

    def test_overlay_returns_actionable_initialization_diagnostic(self):
        failure = gee_service.GeeServiceError("project_not_registered", "Project registration is required.")
        with patch.object(gee_service, "initialize_gee", side_effect=failure):
            result = gee_service.get_satellite_overlay_bounds(12.88, 74.84)
        self.assertFalse(result["available"])
        self.assertEqual(result["error_code"], "project_not_registered")
        self.assertIn("registration", result["message"])

    def test_overlay_retries_transient_network_failure(self):
        recovered = {"available": True, "scene_count": 2}
        with patch.object(gee_service, "_get_satellite_overlay_bounds_once", side_effect=[
            {"available": False, "error_code": "network_error", "message": "temporary"},
            recovered,
        ]) as request, patch.object(gee_service.time, "sleep"):
            result = gee_service.get_satellite_overlay_bounds(12.88, 74.84)
        self.assertEqual(result, recovered)
        self.assertEqual(request.call_count, 2)

    def test_overlay_does_not_retry_permission_failures(self):
        denied = {"available": False, "error_code": "permission_denied", "message": "Access denied."}
        with patch.object(gee_service, "_get_satellite_overlay_bounds_once", return_value=denied) as request:
            result = gee_service.get_satellite_overlay_bounds(12.88, 74.84)
        self.assertEqual(result["error_code"], "permission_denied")
        request.assert_called_once()

    def test_missing_configuration_is_reported_without_reading_credentials(self):
        with patch.object(gee_service, "GEE_PROJECT_ID", ""):
            with self.assertRaises(gee_service.GeeServiceError) as raised:
                gee_service.initialize_gee()
        self.assertEqual(raised.exception.code, "configuration_missing")
        self.assertIn("GEE_PROJECT_ID", str(raised.exception))

    def test_water_leak_analysis_preserves_initialization_diagnostic(self):
        failure = gee_service.GeeServiceError("authentication_error", "Earth Engine authentication failed.")
        with patch.object(water_leak_analysis, "initialize_gee", side_effect=failure):
            with self.assertRaises(gee_service.GeeServiceError) as raised:
                water_leak_analysis.analyze_water_leak(12.88, 74.84, 250, date(2026, 10, 1), date(2026, 10, 20))
        self.assertEqual(raised.exception.code, "authentication_error")


if __name__ == "__main__":
    unittest.main()
