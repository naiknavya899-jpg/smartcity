import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_IMAGE_NAME = /\.(jpe?g|png|webp)$/i

function getInitials(name) {
  return (name || 'Urban Eye').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export default function Profile() {
  const { user, updateProfile, updateProfilePicture } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phoneNumber, setPhoneNumber] = useState(user?.phone_number || '')
  const [smsEnabled, setSmsEnabled] = useState(user?.sms_notifications_enabled || false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pictureMenuOpen, setPictureMenuOpen] = useState(false)
  const [pictureFile, setPictureFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [pictureError, setPictureError] = useState('')
  const [pictureMessage, setPictureMessage] = useState('')
  const [pictureSaving, setPictureSaving] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const galleryInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const videoRef = useRef(null)

  useEffect(() => {
    if (!pictureFile) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(pictureFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pictureFile])

  useEffect(() => {
    if (!cameraOpen) return undefined
    let stream
    let cancelled = false
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') { setCameraOpen(false); setPictureFile(null); setPictureError(''); setCameraError('') }
    }
    window.addEventListener('keydown', closeOnEscape)

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access is unavailable here. Use the device camera picker below, or choose a photo from your gallery.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setCameraError('')
      } catch (cameraFailure) {
        const denied = cameraFailure?.name === 'NotAllowedError' || cameraFailure?.name === 'SecurityError'
        setCameraError(denied
          ? 'Camera permission was denied. Allow camera access in your browser, or use the device camera picker below.'
          : 'We could not open a camera on this device. Use the device camera picker below, or choose a gallery photo.')
      }
    }
    startCamera()
    return () => {
      cancelled = true
      window.removeEventListener('keydown', closeOnEscape)
      stream?.getTracks().forEach((track) => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [cameraOpen])

  const selectPicture = (file) => {
    setPictureError('')
    setPictureMessage('')
    if (!file) return
    if (file.size > MAX_IMAGE_SIZE) {
      setPictureError('Choose an image that is 5 MB or smaller.')
      return
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type) && !ALLOWED_IMAGE_NAME.test(file.name || '')) {
      setPictureError('Choose a JPG, PNG, or WebP image.')
      return
    }
    setPictureFile(file)
    setCameraOpen(false)
    setPictureMenuOpen(false)
  }

  const cancelPictureEdit = () => {
    setCameraOpen(false)
    setPictureFile(null)
    setPictureError('')
    setCameraError('')
    setPictureMenuOpen(false)
  }

  const startGalleryPicker = () => {
    setPictureError('')
    setPictureMessage('')
    galleryInputRef.current?.click()
  }

  const startCamera = () => {
    setPictureError('')
    setPictureMessage('')
    setCameraError('')
    setPictureFile(null)
    setCameraOpen(true)
  }

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraError('The camera is not ready yet. Please wait a moment and try again.')
      return
    }
    const scale = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) {
      setCameraError('This browser cannot capture the camera image. Use the device camera picker below.')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError('The photo could not be captured. Please try again.')
        return
      }
      setPictureFile(new File([blob], 'urban-eye-profile.jpg', { type: 'image/jpeg' }))
      setCameraOpen(false)
      setCameraError('')
    }, 'image/jpeg', 0.88)
  }

  const savePicture = async () => {
    if (!pictureFile) return
    setPictureSaving(true)
    setPictureError('')
    setPictureMessage('')
    try {
      await updateProfilePicture(pictureFile)
      setPictureFile(null)
      setPictureMessage('Profile picture updated successfully.')
    } catch (saveError) {
      setPictureError(saveError.message || 'Unable to save your profile picture. Please try again.')
    } finally {
      setPictureSaving(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await updateProfile({
        name: name.trim(),
        email: email.trim(),
        phone_number: phoneNumber,
        sms_notifications_enabled: smsEnabled,
      })
      setMessage('Profile updated successfully.')
    } catch (err) {
      setError(err.message || 'Unable to update your profile.')
    } finally {
      setSaving(false)
    }
  }

  const profileImageUrl = user?.profile_image_path ? `/uploads/${encodeURIComponent(user.profile_image_path)}` : ''

  return (
    <div className="container profile-page" style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1>My Profile</h1>
        <p>Edit your account details. Your account role cannot be changed here.</p>
      </div>

      <section className="card profile-picture-card" aria-label="Profile picture">
        <div className="profile-picture-avatar" aria-label={user?.name ? `${user.name} profile picture` : 'Profile picture'}>
          {profileImageUrl
            ? <img src={profileImageUrl} alt="Your profile" />
            : <span>{getInitials(user?.name)}</span>}
        </div>
        <div className="profile-picture-copy">
          <h2>Profile Picture</h2>
          <p>Choose a photo or take one with your device camera.</p>
          <button type="button" className="btn btn-outline profile-picture-edit" onClick={() => setPictureMenuOpen((open) => !open)} aria-expanded={pictureMenuOpen}>
            Edit Profile Picture
          </button>
          {pictureMenuOpen && <div className="profile-picture-options">
            <button type="button" onClick={startGalleryPicker}>Choose from Gallery</button>
            <button type="button" onClick={startCamera}>Take a Photo</button>
          </div>}
          <input ref={galleryInputRef} className="profile-file-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { selectPicture(event.target.files?.[0]); event.target.value = '' }} />
          <input ref={cameraInputRef} className="profile-file-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" capture="user" onChange={(event) => { selectPicture(event.target.files?.[0]); event.target.value = '' }} />
        </div>
      </section>
      {pictureError && !pictureFile && <p className="error-msg profile-picture-feedback" role="alert">{pictureError}</p>}
      {pictureMessage && <p className="success-msg profile-picture-feedback" role="status">{pictureMessage}</p>}

      <form className="card" id="settings" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="profile-name">Full name</label>
          <input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required />
        </div>
        <div className="form-group">
          <label htmlFor="profile-email">Email</label>
          <input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="profile-phone">Mobile number for SMS updates</label>
          <input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phoneNumber}
            onChange={(event) => {
              const nextNumber = event.target.value
              if (nextNumber !== user?.phone_number) setSmsEnabled(false)
              setPhoneNumber(nextNumber)
            }}
            placeholder="10-digit Indian mobile number"
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          <input type="checkbox" checked={smsEnabled} onChange={(event) => setSmsEnabled(event.target.checked)} disabled={!phoneNumber.trim()} />
          Send SMS updates when my complaints are registered or their status changes.
        </label>
        <div className="form-group">
          <label>Account type</label>
          <input value={user?.role === 'admin' ? 'Administrator' : 'Citizen'} readOnly />
        </div>
        {error && <p className="error-msg" role="alert">{error}</p>}
        {message && <p className="success-msg" role="status">{message}</p>}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>

      {(cameraOpen || pictureFile) && <div className="profile-picture-backdrop">
        <section className="profile-picture-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-picture-dialog-title">
          <h2 id="profile-picture-dialog-title">{pictureFile ? 'Preview Profile Picture' : 'Take a Photo'}</h2>
          {pictureFile && previewUrl
            ? <img className="profile-picture-preview" src={previewUrl} alt="Preview of the new profile picture" onError={() => { setPictureError('This file could not be opened as an image. Choose a valid JPG, PNG, or WebP file.'); setPictureFile(null) }} />
            : <div className="profile-camera-frame"><video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />{cameraError && <p role="alert">{cameraError}</p>}</div>}
          {pictureError && <p className="error-msg" role="alert">{pictureError}</p>}
          {!pictureFile && cameraError && <button type="button" className="btn btn-outline" onClick={() => cameraInputRef.current?.click()}>Use Device Camera Picker</button>}
          <div className="profile-picture-dialog-actions">
            {pictureFile ? <>
              <button type="button" className="btn btn-outline" onClick={() => { setPictureFile(null); setCameraError(''); setCameraOpen(true) }} disabled={pictureSaving}>Retake</button>
              <button type="button" className="btn btn-outline" onClick={cancelPictureEdit} disabled={pictureSaving}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={savePicture} disabled={pictureSaving}>{pictureSaving ? 'Saving...' : 'Save Picture'}</button>
            </> : <>
              {!cameraError && <button type="button" className="btn btn-primary" onClick={capturePhoto}>Capture Photo</button>}
              <button type="button" className="btn btn-outline" onClick={cancelPictureEdit}>Cancel</button>
            </>}
          </div>
        </section>
      </div>}
    </div>
  )
}
