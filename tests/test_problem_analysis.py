import json
import unittest
from unittest.mock import Mock, patch

from pydantic import ValidationError

from app.schemas import ProblemAnalysisRequest
from app.services import problem_analysis
from app.services.problem_analysis import (
    AIConfigurationError,
    AIProviderError,
    analyze_problem_text,
    normalize_analysis,
    parse_analysis_json,
)


def sample_analysis():
    return {
        "overall_summary": "Improve the reporting application and organize the work.",
        "detected_intent": "Plan software improvements.",
        "sections": [
            {
                "section_id": "temporary-1",
                "section_name": "Frontend",
                "section_summary": "Improve the user interface.",
                "problems": [
                    {
                        "problem_id": "temporary-a",
                        "title": "Fix mobile layout",
                        "description": "Prevent the page from overflowing on phones.",
                        "priority": "High",
                        "status": "Pending",
                        "suggested_solution": "Use responsive grid rules.",
                        "dependencies": [],
                        "missing_information": [],
                        "assumptions": [],
                    }
                ],
            }
        ],
        "execution_plan": ["Inspect the current layout.", "Apply responsive changes."],
        "follow_up_questions": [],
    }


class ProblemAnalysisTests(unittest.TestCase):
    def test_input_validation_rejects_blank_and_oversized_text(self):
        with self.assertRaises(ValidationError):
            ProblemAnalysisRequest(input_text="  \n ")
        with self.assertRaises(ValidationError):
            ProblemAnalysisRequest(input_text="x" * 20001)
        self.assertEqual(ProblemAnalysisRequest(input_text="  Fix the mobile layout  ").input_text, "Fix the mobile layout")

    def test_json_is_validated_and_ids_are_normalized(self):
        result = parse_analysis_json(json.dumps(sample_analysis()))
        self.assertEqual(result.sections[0].section_id, "S1")
        self.assertEqual(result.sections[0].problems[0].problem_id, "P1")

    def test_malformed_or_wrong_shape_json_is_rejected(self):
        for content in ("not json", json.dumps({"sections": []})):
            with self.subTest(content=content), self.assertRaises(AIProviderError):
                parse_analysis_json(content)

    def test_duplicate_sections_and_tasks_merge_without_losing_details(self):
        data = sample_analysis()
        data["sections"].append({
            "section_id": "temporary-2",
            "section_name": "frontend",
            "section_summary": "Keep the mobile experience accessible.",
            "problems": [{
                "problem_id": "temporary-b",
                "title": "Fix mobile layout!",
                "description": "Check keyboard and touch access on phones.",
                "priority": "Medium",
                "status": "In Progress",
                "suggested_solution": "Add keyboard focus checks.",
                "dependencies": ["Shared navigation styles"],
                "missing_information": ["Supported minimum screen width"],
                "assumptions": ["Mobile layout should support 320 px screens"],
            }],
        })
        normalized = normalize_analysis(problem_analysis.ProblemAnalysisResult.model_validate(data))
        self.assertEqual(len(normalized.sections), 1)
        self.assertEqual(len(normalized.sections[0].problems), 1)
        problem = normalized.sections[0].problems[0]
        self.assertIn("keyboard and touch", problem.description)
        self.assertIn("keyboard focus", problem.suggested_solution)
        self.assertEqual(problem.priority, "High")
        self.assertEqual(problem.status, "In Progress")
        self.assertEqual(problem.dependencies, ["Shared navigation styles"])
        self.assertEqual(problem.problem_id, "P1")

    def test_missing_key_returns_clear_configuration_error_without_network_call(self):
        with patch.object(problem_analysis, "OPENAI_API_KEY", ""), patch.object(problem_analysis, "urlopen") as urlopen:
            with self.assertRaises(AIConfigurationError):
                analyze_problem_text("Organize these tasks")
            urlopen.assert_not_called()

    def test_provider_response_is_requested_as_json_schema(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"output": [{"type": "message", "content": [{
            "type": "output_text", "text": json.dumps(sample_analysis())
        }]}]}).encode()
        with patch.object(problem_analysis, "OPENAI_API_KEY", "test-key"), patch(
            "app.services.problem_analysis.urlopen", return_value=response
        ) as urlopen:
            result = analyze_problem_text("Fix the mobile layout")
        request = urlopen.call_args.args[0]
        payload = json.loads(request.data.decode())
        self.assertEqual(result.sections[0].section_id, "S1")
        self.assertEqual(payload["text"]["format"]["type"], "json_schema")
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertFalse(payload["store"])
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")


if __name__ == "__main__":
    unittest.main()
