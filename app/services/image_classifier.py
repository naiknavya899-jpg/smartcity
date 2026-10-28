"""Image-based issue classification using color/texture heuristics."""

from pathlib import Path

from PIL import Image
import numpy as np

CATEGORY_PROFILES = {
    "pothole": {"dark_ratio_range": (0.25, 0.55), "edge_density": (0.08, 0.25)},
    "garbage": {"color_variance_min": 800, "saturation_mean": (40, 120)},
    "water_leakage": {"blue_ratio_min": 0.08, "brightness_range": (80, 180)},
    "streetlight": {"brightness_max": 70, "yellow_ratio_min": 0.05},
    "damaged_road": {"gray_ratio_min": 0.35, "edge_density": (0.1, 0.3)},
    "drainage": {"dark_ratio_range": (0.3, 0.6), "green_ratio_max": 0.15},
}


def _image_features(image_path: str) -> dict:
    img = Image.open(image_path).convert("RGB").resize((224, 224))
    arr = np.array(img, dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    total = arr.size / 3

    brightness = float(arr.mean())
    dark_ratio = float((arr.mean(axis=2) < 80).sum()) / (224 * 224)
    gray_ratio = float(((np.abs(r - g) < 20) & (np.abs(g - b) < 20)).sum()) / (224 * 224)
    blue_ratio = float(b.sum()) / (r.sum() + g.sum() + b.sum() + 1e-6)
    yellow_ratio = float(((r > 150) & (g > 120) & (b < 80)).sum()) / (224 * 224)
    color_variance = float(arr.var())
    saturation = float(np.std(arr, axis=2).mean())

    gray = np.mean(arr, axis=2)
    edges = np.abs(np.diff(gray, axis=0)).mean() + np.abs(np.diff(gray, axis=1)).mean()
    edge_density = float(edges / 255.0)

    return {
        "brightness": brightness,
        "dark_ratio": dark_ratio,
        "gray_ratio": gray_ratio,
        "blue_ratio": blue_ratio,
        "yellow_ratio": yellow_ratio,
        "color_variance": color_variance,
        "saturation": saturation,
        "edge_density": edge_density,
    }


def classify_image(image_path: str) -> dict:
    if not Path(image_path).exists():
        return {"category": "other", "confidence": 0.0}

    features = _image_features(image_path)
    scores: dict[str, float] = {}

    if 0.25 <= features["dark_ratio"] <= 0.55 and 0.08 <= features["edge_density"] <= 0.25:
        scores["pothole"] = 0.7
    if features["color_variance"] > 800 and 40 <= features["saturation"] <= 120:
        scores["garbage"] = 0.65
    if features["blue_ratio"] > 0.08 and 80 <= features["brightness"] <= 180:
        scores["water_leakage"] = 0.6
    if features["brightness"] < 70 or features["yellow_ratio"] > 0.05:
        scores["streetlight"] = 0.55
    if features["gray_ratio"] > 0.35 and features["edge_density"] > 0.1:
        scores["damaged_road"] = 0.6
    if 0.3 <= features["dark_ratio"] <= 0.6:
        scores["drainage"] = 0.5

    if scores:
        category = max(scores, key=scores.get)
        confidence = scores[category]
    else:
        category = "other"
        confidence = 0.35

    return {"category": category, "confidence": round(confidence, 2)}
