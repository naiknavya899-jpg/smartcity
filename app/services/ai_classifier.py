"""Combined AI analysis: merges NLP text analysis and image classification."""

from app.config import DEPARTMENTS
from app.services.image_classifier import classify_image
from app.services.nlp_analyzer import analyze_text


def analyze_complaint(description: str, image_path: str | None = None) -> dict:
    text_result = analyze_text(description)
    image_result = (
        classify_image(image_path) if image_path else {"category": None, "confidence": 0.0}
    )

    if image_result["category"] and image_result["confidence"] > 0.5:
        if text_result["confidence"] > 0.5 and text_result["category"] != image_result["category"]:
            # Weighted merge when both signals disagree
            if image_result["confidence"] >= text_result["confidence"]:
                category = image_result["category"]
                confidence = image_result["confidence"]
            else:
                category = text_result["category"]
                confidence = text_result["confidence"]
        elif image_result["confidence"] >= text_result["confidence"]:
            category = image_result["category"]
            confidence = image_result["confidence"]
        else:
            category = text_result["category"]
            confidence = text_result["confidence"]
    else:
        category = text_result["category"]
        confidence = text_result["confidence"]

    priority = text_result["priority"]
    if confidence >= 0.7 and priority == "medium":
        priority = "high"

    return {
        "category": category,
        "priority": priority,
        "department": DEPARTMENTS.get(category, DEPARTMENTS["other"]),
        "confidence": round(confidence, 2),
        "nlp_keywords": text_result["keywords"],
    }
