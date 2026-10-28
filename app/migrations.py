"""Small additive SQLite-compatible schema upgrades for existing installations."""

from sqlalchemy import inspect, text


COMPLAINT_MEDIA_COLUMNS = {
    "image_width": "INTEGER",
    "image_height": "INTEGER",
    "video_path": "VARCHAR(500)",
    "video_width": "INTEGER",
    "video_height": "INTEGER",
    "video_duration_seconds": "FLOAT",
}


def ensure_complaint_media_columns(engine) -> None:
    existing = {column["name"] for column in inspect(engine).get_columns("complaints")}
    with engine.begin() as connection:
        for name, sql_type in COMPLAINT_MEDIA_COLUMNS.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE complaints ADD COLUMN {name} {sql_type}"))
