"""NLP-based complaint text analysis for category and priority hints."""

import re
from collections import Counter

CATEGORY_KEYWORDS = {
    "pothole": [
        "pothole", "hole", "crack", "road damage", "broken road", "uneven",
        "bump", "asphalt", "pavement",
    ],
    "garbage": [
        "garbage", "trash", "waste", "litter", "dump", "rubbish", "filth",
        "sanitation", "bin", "overflow",
    ],
    "water_leakage": [
        "water", "leak", "leakage", "pipe", "burst", "flood", "seepage",
        "drinking water", "supply",
    ],
    "streetlight": [
        "streetlight", "street light", "lamp", "lighting", "dark", "bulb",
        "pole light", "not working",
    ],
    "damaged_road": [
        "damaged road", "road repair", "broken pavement", "sinkhole",
        "road collapse", "bad road",
    ],
    "drainage": [
        "drain", "drainage", "sewage", "blockage", "manhole", "overflow",
        "stagnant water", "clogged",
    ],
    "traffic_signal": [
        "traffic", "signal", "junction", "crossing", "red light",
        "traffic light", "accident prone",
    ],
}

PRIORITY_KEYWORDS = {
    "high": [
        "urgent", "emergency", "dangerous", "accident", "injury", "severe",
        "critical", "immediate", "hazard", "unsafe", "flooding",
    ],
    "medium": [
        "moderate", "needs attention", "worsening", "recurring", "blocked",
    ],
    "low": [
        "minor", "small", "cosmetic", "slight", "when possible", "low priority",
    ],
}


def analyze_text(description: str) -> dict:
    text = description.lower()
    tokens = re.findall(r"[a-z]+", text)

    category_scores: dict[str, float] = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score:
            category_scores[category] = score

    if category_scores:
        category = max(category_scores, key=category_scores.get)
        cat_confidence = min(category_scores[category] / 3.0, 1.0)
    else:
        category = "other"
        cat_confidence = 0.3

    priority = "medium"
    for level in ("high", "low", "medium"):
        if any(kw in text for kw in PRIORITY_KEYWORDS[level]):
            priority = level
            break

    found_keywords = []
    for kw_list in CATEGORY_KEYWORDS.values():
        for kw in kw_list:
            if kw in text:
                found_keywords.append(kw)

    return {
        "category": category,
        "priority": priority,
        "confidence": round(cat_confidence, 2),
        "keywords": list(dict.fromkeys(found_keywords))[:10],
    }
