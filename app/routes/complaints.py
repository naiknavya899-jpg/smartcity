import math
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from PIL import Image, ExifTags

from app.auth import get_current_user
from app.config import UPLOAD_DIR
from app.database import get_db
from app.models import Complaint, StatusHistory, User
from app.schemas import ComplaintResponse
from app.services.ai_classifier import analyze_complaint
from app.services.complaint_media import save_photo, save_video
from app.services.sms import enqueue_notification

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

def _photo_metadata(filepath: Path) -> dict:
    metadata = {"photo_datetime_original": None, "photo_create_date": None, "photo_gps_latitude": None, "photo_gps_longitude": None, "photo_make": None, "photo_model": None}
    try:
        with Image.open(filepath) as image:
            exif = image.getexif()
            tags = {ExifTags.TAGS.get(key, str(key)): value for key, value in exif.items()}
            metadata["photo_make"] = str(tags.get("Make", "")).strip()[:120] or None
            metadata["photo_model"] = str(tags.get("Model", "")).strip()[:120] or None
            exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
            exif_tags = {ExifTags.TAGS.get(key, str(key)): value for key, value in exif_ifd.items()}
            metadata["photo_datetime_original"] = str(exif_tags.get("DateTimeOriginal", "")).strip()[:80] or None
            metadata["photo_create_date"] = str(exif_tags.get("CreateDate") or exif_tags.get("DateTimeDigitized", "")).strip()[:80] or None
            gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
            gps = {ExifTags.GPSTAGS.get(key, str(key)): value for key, value in gps_ifd.items()}
            def decimal(value):
                parts = [float(part) for part in value]
                return parts[0] + parts[1] / 60 + parts[2] / 3600
            if gps.get("GPSLatitude") and gps.get("GPSLongitude"):
                lat, lon = decimal(gps["GPSLatitude"]), decimal(gps["GPSLongitude"])
                if gps.get("GPSLatitudeRef") == "S": lat = -lat
                if gps.get("GPSLongitudeRef") == "W": lon = -lon
                if -90 <= lat <= 90 and -180 <= lon <= 180:
                    metadata["photo_gps_latitude"], metadata["photo_gps_longitude"] = lat, lon
    except Exception:
        # Unsupported, malformed, or absent metadata remains unavailable; the original is preserved.
        pass
    return metadata
@router.post("", response_model=ComplaintResponse)
async def create_complaint(
    title: str = Form(..., min_length=3, max_length=200),
    description: str = Form(..., min_length=10),
    latitude: float = Form(..., ge=-90, le=90),
    longitude: float = Form(..., ge=-180, le=180),
    address: str = Form(None),
    image: UploadFile = File(None),
    video: UploadFile = File(None),
    photo_source: str = Form(None),
    device_gps_latitude: float = Form(None, ge=-90, le=90),
    device_gps_longitude: float = Form(None, ge=-180, le=180),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    title = title.strip()
    description = description.strip()
    if len(title) < 3 or len(title) > 200 or len(description) < 10:
        raise HTTPException(status_code=422, detail="Enter a valid title and a description of at least 10 characters")
    if (
        not math.isfinite(latitude)
        or not math.isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        raise HTTPException(status_code=422, detail="Enter valid latitude and longitude coordinates")
    address = address.strip() if isinstance(address, str) else ""
    if not address:
        raise HTTPException(status_code=422, detail={
            "code": "address_required",
            "message": "Enter the address or place where the problem occurred.",
        })
    if len(address) > 300:
        raise HTTPException(status_code=422, detail={
            "code": "address_too_long",
            "message": "Keep the address or place under 300 characters.",
        })
    if not image or not image.filename:
        raise HTTPException(status_code=422, detail={
            "code": "photo_required",
            "message": "A photo is required to submit a complaint. Please attach a JPG, PNG, or WebP image.",
        })
    if not video or not video.filename:
        raise HTTPException(status_code=422, detail={
            "code": "video_required",
            "message": "A video is required to submit a complaint. Please attach an MP4 video.",
        })

    if not isinstance(photo_source, str):
        photo_source = None
    if not isinstance(device_gps_latitude, (int, float)):
        device_gps_latitude = None
    if not isinstance(device_gps_longitude, (int, float)):
        device_gps_longitude = None
    image_path = video_path = None
    image_dimensions = video_metadata = {}
    try:
        if image and image.filename:
            image_path, image_dimensions = await save_photo(image)
        if video and video.filename:
            video_path, video_metadata = await save_video(video)
    except Exception:
        if image_path:
            (UPLOAD_DIR / image_path).unlink(missing_ok=True)
        raise

    full_image_path = str(UPLOAD_DIR / image_path) if image_path else None
    photo_metadata = _photo_metadata(UPLOAD_DIR / image_path) if image_path else {}
    try:
        ai_result = analyze_complaint(description, full_image_path)
    except Exception:
        if image_path:
            (UPLOAD_DIR / image_path).unlink(missing_ok=True)
        if video_path:
            (UPLOAD_DIR / video_path).unlink(missing_ok=True)
        raise

    complaint = Complaint(
        user_id=current_user.id,
        title=title,
        description=description,
        category=ai_result["category"],
        priority=ai_result["priority"],
        department=ai_result["department"],
        image_path=image_path,
        image_width=image_dimensions.get("image_width"),
        image_height=image_dimensions.get("image_height"),
        video_path=video_path,
        video_width=video_metadata.get("video_width"),
        video_height=video_metadata.get("video_height"),
        video_duration_seconds=video_metadata.get("video_duration_seconds"),
        latitude=latitude,
        longitude=longitude,
        address=address,
        ai_confidence=ai_result["confidence"],
        photo_source=photo_source if photo_source in {"camera_picker", "gallery"} else None,
        device_gps_latitude=device_gps_latitude,
        device_gps_longitude=device_gps_longitude,
        **photo_metadata,
    )
    try:
        db.add(complaint)
        db.flush()
        history = StatusHistory(
            complaint_id=complaint.id,
            status=complaint.status,
            event_type="report_submitted",
            actor_user_id=current_user.id,
            actor_name=current_user.name,
            note=f"AI classified as {ai_result['category']} ({ai_result['confidence']*100:.0f}% confidence)",
        )
        db.add(history)
        enqueue_notification(db, complaint, "created")
        db.commit()
        db.refresh(complaint)
    except Exception:
        db.rollback()
        if image_path:
            (UPLOAD_DIR / image_path).unlink(missing_ok=True)
        if video_path:
            (UPLOAD_DIR / video_path).unlink(missing_ok=True)
        raise

    return ComplaintResponse.model_validate(complaint)


@router.get("/mine", response_model=list[ComplaintResponse])
def get_my_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    complaints = (
        db.query(Complaint)
        .filter(Complaint.user_id == current_user.id)
        .order_by(Complaint.created_at.desc())
        .all()
    )
    return [ComplaintResponse.model_validate(c) for c in complaints]


@router.get("/{complaint_id}", response_model=ComplaintResponse)
def get_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return ComplaintResponse.model_validate(complaint)






