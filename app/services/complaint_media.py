"""Content-based validation and safe storage for complaint evidence uploads."""

import asyncio
import io
import struct
import uuid
import warnings
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from app.config import UPLOAD_DIR
from app.upload_settings import (
    PHOTO_EXTENSIONS,
    PHOTO_FORMATS,
    PHOTO_MAX_BYTES,
    PHOTO_MIN_HEIGHT,
    PHOTO_MIN_WIDTH,
    VIDEO_MAX_BYTES,
    VIDEO_MAX_DURATION_SECONDS,
    VIDEO_MIN_HEIGHT,
    VIDEO_MIN_WIDTH,
)

CHUNK_SIZE = 1024 * 1024


def _upload_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


async def _read_limited(file: UploadFile, maximum: int, kind: str) -> bytes:
    known_size = getattr(file, "size", None)
    if known_size is not None and known_size > maximum:
        raise _too_large(kind)
    data = await file.read(maximum + 1)
    if len(data) > maximum:
        raise _too_large(kind)
    return data


def _too_large(kind: str) -> HTTPException:
    if kind == "photo":
        return _upload_error(413, "photo_too_large", "Your photo is larger than 5 MB. Please choose a smaller image or compress it before uploading.")
    return _upload_error(413, "video_too_large", "Your video exceeds the 50 MB limit. Please choose a smaller video.")


async def save_photo(file: UploadFile) -> tuple[str, dict]:
    extension = Path(file.filename or "").suffix.lower()
    expected_format = PHOTO_EXTENSIONS.get(extension)
    if not expected_format:
        raise _upload_error(415, "unsupported_photo_format", "Choose a JPG, JPEG, PNG, or WebP photo.")

    data = await _read_limited(file, PHOTO_MAX_BYTES, "photo")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                actual_format = image.format
                image.verify()
        if actual_format not in PHOTO_FORMATS or actual_format != expected_format:
            raise _upload_error(415, "unsupported_photo_format", "The photo content does not match a supported JPG, PNG, or WebP format.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                width, height = image.size
                if width < 1 or height < 1:
                    raise _upload_error(400, "invalid_photo", "The selected photo is invalid or corrupted.")
                image.load()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _upload_error(400, "invalid_photo", "The selected photo is invalid or corrupted. Choose a valid JPG, PNG, or WebP image.") from None

    filename = f"{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / filename
    try:
        with destination.open("xb") as output:
            output.write(data)
    except OSError:
        raise _upload_error(500, "photo_storage_failed", "The photo could not be saved. Please retry the upload.") from None
    return filename, {
        "image_width": width,
        "image_height": height,
        "low_resolution": width < PHOTO_MIN_WIDTH or height < PHOTO_MIN_HEIGHT,
    }


def _atom_header(file, offset: int, end: int):
    if offset + 8 > end:
        return None
    file.seek(offset)
    header = file.read(8)
    if len(header) != 8:
        return None
    size, kind = struct.unpack(">I4s", header)
    header_size = 8
    if size == 1:
        extended = file.read(8)
        if len(extended) != 8:
            return None
        size = struct.unpack(">Q", extended)[0]
        header_size = 16
    elif size == 0:
        size = end - offset
    if size < header_size or offset + size > end:
        return None
    return kind.decode("latin-1"), offset + header_size, offset + size


def _atoms(file, start: int, end: int):
    found = []
    position = start
    while position < end:
        atom = _atom_header(file, position, end)
        if atom is None:
            raise ValueError("Malformed MP4 atom")
        kind, payload_start, atom_end = atom
        found.append((kind, payload_start, atom_end))
        position = atom_end
    return found


def _read_u32(file, position: int) -> int:
    file.seek(position)
    data = file.read(4)
    if len(data) != 4:
        raise ValueError("Truncated MP4 metadata")
    return struct.unpack(">I", data)[0]


def _mp4_metadata(path: Path) -> tuple[int, int, float]:
    size = path.stat().st_size
    with path.open("rb") as media:
        top = _atoms(media, 0, size)
        kinds = {kind for kind, _, _ in top}
        if not {"ftyp", "moov", "mdat"}.issubset(kinds):
            raise ValueError("Incomplete MP4 container")
        moov = next(atom for atom in top if atom[0] == "moov")
        moov_children = _atoms(media, moov[1], moov[2])
        mvhd = next((atom for atom in moov_children if atom[0] == "mvhd"), None)
        if not mvhd:
            raise ValueError("Missing movie metadata")
        media.seek(mvhd[1])
        fullbox = media.read(1)
        if not fullbox:
            raise ValueError("Truncated movie metadata")
        version = fullbox[0]
        timescale_offset, duration_offset, duration_size = (20, 24, 8) if version == 1 else (12, 16, 4)
        timescale = _read_u32(media, mvhd[1] + timescale_offset)
        if timescale <= 0:
            raise ValueError("Invalid movie timescale")
        media.seek(mvhd[1] + duration_offset)
        duration_bytes = media.read(duration_size)
        if len(duration_bytes) != duration_size:
            raise ValueError("Truncated movie duration")
        duration_units = struct.unpack(">Q" if duration_size == 8 else ">I", duration_bytes)[0]
        duration = duration_units / timescale

        width = height = 0
        for kind, trak_start, trak_end in (a for a in moov_children if a[0] == "trak"):
            trak_children = _atoms(media, trak_start, trak_end)
            tkhd = next((atom for atom in trak_children if atom[0] == "tkhd"), None)
            mdia = next((atom for atom in trak_children if atom[0] == "mdia"), None)
            if not tkhd or not mdia:
                continue
            media_children = _atoms(media, mdia[1], mdia[2])
            hdlr = next((atom for atom in media_children if atom[0] == "hdlr"), None)
            if not hdlr:
                continue
            media.seek(hdlr[1] + 8)
            if media.read(4) != b"vide":
                continue
            media.seek(tkhd[1])
            tkhd_version_bytes = media.read(1)
            if not tkhd_version_bytes:
                raise ValueError("Truncated track metadata")
            dimensions_offset = 88 if tkhd_version_bytes[0] == 1 else 76
            media.seek(tkhd[1] + dimensions_offset)
            dimensions = media.read(8)
            if len(dimensions) != 8:
                raise ValueError("Truncated track dimensions")
            width_fixed, height_fixed = struct.unpack(">II", dimensions)
            width, height = width_fixed >> 16, height_fixed >> 16
            break
        if width <= 0 or height <= 0 or duration <= 0:
            raise ValueError("Video track metadata is incomplete")
        return width, height, duration


async def save_video(file: UploadFile) -> tuple[str, dict]:
    extension = Path(file.filename or "").suffix.lower()
    if extension != ".mp4":
        raise _upload_error(415, "unsupported_video_format", "Choose an MP4 video.")
    known_size = getattr(file, "size", None)
    if known_size is not None and known_size > VIDEO_MAX_BYTES:
        raise _too_large("video")

    filename = f"{uuid.uuid4().hex}.mp4"
    destination = UPLOAD_DIR / filename
    written = 0
    try:
        with destination.open("xb") as output:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                written += len(chunk)
                if written > VIDEO_MAX_BYTES:
                    raise _too_large("video")
                output.write(chunk)
        if written == 0:
            raise _upload_error(400, "empty_video", "Choose a non-empty MP4 video.")
        with destination.open("rb") as media:
            if media.read(8)[4:8] != b"ftyp":
                raise _upload_error(400, "invalid_video", "The selected file is not a valid MP4 video.")
        width, height, duration = await asyncio.to_thread(_mp4_metadata, destination)
        if duration > VIDEO_MAX_DURATION_SECONDS:
            raise _upload_error(400, "video_too_long", "Your video is longer than 60 seconds. Please upload a shorter video.")
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    except (OSError, ValueError, StopIteration, struct.error):
        destination.unlink(missing_ok=True)
        raise _upload_error(400, "invalid_video", "The selected MP4 is invalid, corrupted, or missing readable video metadata.") from None

    return filename, {
        "video_width": width,
        "video_height": height,
        "video_duration_seconds": round(duration, 3),
        "video_low_resolution": width < VIDEO_MIN_WIDTH or height < VIDEO_MIN_HEIGHT,
    }
