import asyncio
import io
import struct
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from PIL import Image
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import UPLOAD_DIR
from app.models import Base, Complaint, User
from app.migrations import ensure_complaint_media_columns
from app.routes import complaints
from app.services.complaint_media import save_photo, save_video
from app.upload_settings import PHOTO_MAX_BYTES, VIDEO_MAX_BYTES


def atom(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", len(payload) + 8, kind) + payload


def make_mp4(width=1920, height=1080, duration_seconds=10):
    movie_header = bytearray(20)
    struct.pack_into(">I", movie_header, 12, 1000)
    struct.pack_into(">I", movie_header, 16, duration_seconds * 1000)
    track_header = bytearray(84)
    struct.pack_into(">I", track_header, 76, width << 16)
    struct.pack_into(">I", track_header, 80, height << 16)
    handler = bytearray(12)
    handler[8:12] = b"vide"
    media = atom(b"mdia", atom(b"hdlr", bytes(handler)))
    track = atom(b"trak", atom(b"tkhd", bytes(track_header)) + media)
    movie = atom(b"moov", atom(b"mvhd", bytes(movie_header)) + track)
    return atom(b"ftyp", b"isom\x00\x00\x00\x00isomiso2") + movie + atom(b"mdat", b"video-data")


def upload(data: bytes, filename: str, size=None) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=filename, size=len(data) if size is None else size)


class ComplaintMediaTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.saved_paths = []

    def tearDown(self):
        for name in self.saved_paths:
            (UPLOAD_DIR / name).unlink(missing_ok=True)

    async def test_additive_media_migration_is_safe_for_existing_complaint_tables(self):
        engine = create_engine("sqlite://")
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE complaints (id INTEGER PRIMARY KEY, title VARCHAR(200))"))
        ensure_complaint_media_columns(engine)
        ensure_complaint_media_columns(engine)
        columns = {column["name"] for column in inspect(engine).get_columns("complaints")}
        self.assertTrue({"image_width", "image_height", "video_path", "video_width", "video_height", "video_duration_seconds"}.issubset(columns))
        engine.dispose()

    async def test_valid_jpeg_and_png_are_detected_and_saved_safely(self):
        for fmt, name in (("JPEG", "evidence.jpg"), ("PNG", "evidence.png")):
            with self.subTest(format=fmt):
                image = Image.new("RGB", (1280, 720), "blue")
                data = io.BytesIO()
                image.save(data, format=fmt)
                stored, details = await save_photo(upload(data.getvalue(), name))
                self.saved_paths.append(stored)
                self.assertRegex(stored, r"^[a-f0-9]{32}\." + ("jpg" if fmt == "JPEG" else "png") + r"$")
                self.assertEqual((details["image_width"], details["image_height"]), (1280, 720))
                self.assertFalse(details["low_resolution"])

    async def test_small_photo_is_accepted_with_low_resolution_flag(self):
        data = io.BytesIO()
        Image.new("RGB", (640, 480), "red").save(data, format="WEBP")
        stored, details = await save_photo(upload(data.getvalue(), "small.webp"))
        self.saved_paths.append(stored)
        self.assertTrue(details["low_resolution"])

    async def test_oversized_and_corrupted_photos_are_rejected(self):
        with self.assertRaises(HTTPException) as oversized:
            await save_photo(upload(b"", "large.jpg", size=PHOTO_MAX_BYTES + 1))
        self.assertEqual(oversized.exception.status_code, 413)
        self.assertEqual(oversized.exception.detail["code"], "photo_too_large")

        with self.assertRaises(HTTPException) as corrupted:
            await save_photo(upload(b"not an image", "broken.jpg"))
        self.assertEqual(corrupted.exception.status_code, 400)

    async def test_content_must_match_allowed_photo_extension(self):
        png = io.BytesIO()
        Image.new("RGB", (8, 8)).save(png, format="PNG")
        with self.assertRaises(HTTPException) as unsupported:
            await save_photo(upload(png.getvalue(), "misleading.jpg"))
        self.assertEqual(unsupported.exception.status_code, 415)

    async def test_mp4_container_metadata_is_saved_with_dimensions_and_duration(self):
        stored, details = await save_video(upload(make_mp4(), "evidence.mp4"))
        self.saved_paths.append(stored)
        self.assertRegex(stored, r"^[a-f0-9]{32}\.mp4$")
        self.assertEqual((details["video_width"], details["video_height"]), (1920, 1080))
        self.assertEqual(details["video_duration_seconds"], 10)
        self.assertFalse(details["video_low_resolution"])

    async def test_low_resolution_video_is_accepted_and_long_video_is_rejected(self):
        stored, details = await save_video(upload(make_mp4(640, 360), "small.mp4"))
        self.saved_paths.append(stored)
        self.assertTrue(details["video_low_resolution"])

        with self.assertRaises(HTTPException) as too_long:
            await save_video(upload(make_mp4(duration_seconds=61), "long.mp4"))
        self.assertEqual(too_long.exception.detail["code"], "video_too_long")

    async def test_oversized_unsupported_and_corrupted_videos_are_rejected(self):
        with self.assertRaises(HTTPException) as oversized:
            await save_video(upload(b"", "large.mp4", size=VIDEO_MAX_BYTES + 1))
        self.assertEqual(oversized.exception.status_code, 413)

        with self.assertRaises(HTTPException) as unsupported:
            await save_video(upload(make_mp4(), "evidence.avi"))
        self.assertEqual(unsupported.exception.status_code, 415)

        with self.assertRaises(HTTPException) as corrupted:
            await save_video(upload(b"not an MP4 file", "broken.mp4"))
        self.assertEqual(corrupted.exception.status_code, 400)

    async def test_complaint_can_store_photo_and_video_together(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=engine)
        db = factory()
        citizen = User(name="Citizen", email="media@example.test", password_hash="unused", role="citizen")
        db.add(citizen)
        db.commit()
        db.refresh(citizen)
        photo_data = io.BytesIO()
        Image.new("RGB", (1280, 720), "green").save(photo_data, format="JPEG")
        with patch("app.routes.complaints.analyze_complaint", return_value={
            "category": "damaged_road", "priority": "medium", "department": "Roads", "confidence": 0.8,
        }):
            response = await complaints.create_complaint(
                title="Damaged road", description="Road is damaged near the intersection.",
                latitude=12.9, longitude=74.8, address="Main Road near the report location",
                image=upload(photo_data.getvalue(), "road.jpg"),
                video=upload(make_mp4(), "road.mp4"),
                db=db, current_user=citizen,
            )
        self.saved_paths.extend([response.image_path, response.video_path])
        self.assertEqual(response.image_width, 1280)
        self.assertEqual(response.video_width, 1920)
        self.assertEqual(response.video_duration_seconds, 10)
        db.close()
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
