import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
from dotenv import load_dotenv

load_dotenv(BASE_DIR / ".env")

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()

UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'smart_city.db'}")

GEE_SERVICE_ACCOUNT = os.getenv("GEE_SERVICE_ACCOUNT", "")
GEE_PRIVATE_KEY_PATH = os.getenv("GEE_PRIVATE_KEY_PATH", "")
GEE_PROJECT_ID = os.getenv("GEE_PROJECT_ID", "")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
SMS_MODE = os.getenv("SMS_MODE", "simulation").strip().lower()
MSG91_AUTH_KEY = os.getenv("MSG91_AUTH_KEY", "")
MSG91_TEMPLATE_NEW = os.getenv("MSG91_TEMPLATE_NEW", "")
MSG91_TEMPLATE_PENDING = os.getenv("MSG91_TEMPLATE_PENDING", "")
MSG91_TEMPLATE_IN_PROGRESS = os.getenv("MSG91_TEMPLATE_IN_PROGRESS", "")
MSG91_TEMPLATE_RESOLVED = os.getenv("MSG91_TEMPLATE_RESOLVED", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()

DEPARTMENTS = {
    "pothole": "Roads & Infrastructure",
    "garbage": "Sanitation Department",
    "water_leakage": "Water Supply Department",
    "streetlight": "Electrical & Lighting",
    "damaged_road": "Roads & Infrastructure",
    "drainage": "Drainage & Sewage",
    "traffic_signal": "Traffic Management",
    "other": "General Municipal Office",
}

ISSUE_CATEGORIES = list(DEPARTMENTS.keys())


