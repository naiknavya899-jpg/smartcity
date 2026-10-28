// Keep these client-side convenience limits in sync with backend/app/upload_settings.py.
// The backend independently validates all submitted media and is authoritative.
export const PHOTO_UPLOAD = {
  maxBytes: 5 * 1024 * 1024,
  minWidth: 1280,
  minHeight: 720,
  preferredWidth: 1920,
  preferredHeight: 1080,
  accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
}

export const VIDEO_UPLOAD = {
  maxBytes: 50 * 1024 * 1024,
  maxDurationSeconds: 60,
  minWidth: 1280,
  minHeight: 720,
  preferredWidth: 1920,
  preferredHeight: 1080,
  accept: 'video/mp4,.mp4',
}
