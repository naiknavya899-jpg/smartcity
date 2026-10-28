from io import BytesIO
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.database import get_db
from app.config import UPLOAD_DIR
from app.models import User, UserRole
from app.schemas import TokenResponse, UserLogin, UserProfileUpdate, UserRegister, UserResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PROFILE_IMAGE_PIXELS = 30_000_000
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


@router.post("/register", response_model=TokenResponse)
def register(payload: UserRegister, db: Session = Depends(get_db)):
    if payload.sms_notifications_enabled and not payload.phone_number:
        raise HTTPException(status_code=422, detail="A valid mobile number is required for SMS updates")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.CITIZEN.value,
        phone_number=payload.phone_number,
        sms_notifications_enabled=payload.sms_notifications_enabled,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.patch("/me", response_model=UserResponse)
def update_me(
    payload: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.sms_notifications_enabled and not (
        payload.phone_number if "phone_number" in payload.model_fields_set else current_user.phone_number
    ):
        raise HTTPException(status_code=422, detail="A valid mobile number is required for SMS updates")
    email = str(payload.email).strip().lower()
    existing = (
        db.query(User)
        .filter(User.email == email, User.id != current_user.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    current_user.name = payload.name.strip()
    current_user.email = email
    if "phone_number" in payload.model_fields_set:
        if payload.phone_number != current_user.phone_number and payload.sms_notifications_enabled is None:
            current_user.sms_notifications_enabled = False
        current_user.phone_number = payload.phone_number
    if payload.sms_notifications_enabled is not None:
        current_user.sms_notifications_enabled = payload.sms_notifications_enabled
    db.commit()
    db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.post("/me/profile-picture", response_model=UserResponse)
async def update_profile_picture(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents = await file.read(MAX_PROFILE_IMAGE_BYTES + 1)
    await file.close()
    if not contents:
        raise HTTPException(status_code=400, detail="Choose an image to upload")
    if len(contents) > MAX_PROFILE_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Profile pictures must be 5 MB or smaller")

    try:
        with Image.open(BytesIO(contents)) as source:
            if source.format not in ALLOWED_IMAGE_FORMATS:
                raise HTTPException(status_code=415, detail="Choose a JPG, PNG, or WebP image")
            if source.width * source.height > MAX_PROFILE_IMAGE_PIXELS:
                raise HTTPException(status_code=400, detail="This image's dimensions are too large")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise HTTPException(status_code=400, detail="The selected file is not a valid supported image")

    output = BytesIO()
    image.save(output, format="JPEG", quality=88, optimize=True)
    filename = f"profile-{current_user.id}-{uuid.uuid4().hex}.jpg"
    destination = UPLOAD_DIR / filename
    old_image = current_user.profile_image_path
    try:
        with destination.open("xb") as stored_file:
            stored_file.write(output.getvalue())
        current_user.profile_image_path = filename
        db.commit()
        db.refresh(current_user)
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Unable to save your profile picture")

    if old_image and old_image.startswith(f"profile-{current_user.id}-"):
        old_path = (UPLOAD_DIR / old_image).resolve()
        if old_path.parent == UPLOAD_DIR.resolve():
            try:
                old_path.unlink(missing_ok=True)
            except OSError:
                pass
    return UserResponse.model_validate(current_user)
