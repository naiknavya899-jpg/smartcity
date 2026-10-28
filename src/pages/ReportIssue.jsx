import { useEffect, useRef, useState } from 'react'
import * as exifr from 'exifr'
import { useNavigate } from 'react-router-dom'
import MapView from '../components/MapView'
import { api } from '../services/api'
import { PHOTO_UPLOAD, VIDEO_UPLOAD } from '../config/uploadSettings'

const GEOCODING_URL = 'https://photon.komoot.io/api/'

function getFeatureLabel(feature) {
  const properties = feature?.properties || {}
  const parts = [properties.name, properties.street, properties.district, properties.city, properties.state, properties.country]
    .filter(Boolean)
  return [...new Set(parts)].join(', ') || 'Selected location'
}

function getFeatureZoom(feature) {
  const properties = feature?.properties || {}
  const type = `${properties.type || ''} ${properties.osm_value || ''}`.toLowerCase()
  if (type.includes('country')) return 5
  if (type.includes('state') || type.includes('region')) return 7
  if (type.includes('city') || type.includes('town')) return 12
  if (type.includes('village') || type.includes('suburb') || type.includes('district')) return 13
  if (type.includes('street') || type.includes('road')) return 16
  if (type.includes('house') || type.includes('building')) return 18
  return 14
}

function getFeatureLocation(feature) {
  const coordinates = feature?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [longitude, latitude] = coordinates.map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { lat: latitude, lng: longitude }
}

function formatFileSize(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function detectImageFormat(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { format: 'jpeg', extension: ['.jpg', '.jpeg'] }
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { format: 'png', extension: ['.png'] }
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { format: 'webp', extension: ['.webp'] }
  return null
}

function probeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('This file could not be decoded as a valid photo. Choose a JPG, PNG, or WebP image.'))
    image.src = url
  })
}

function probeVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const timer = window.setTimeout(() => { video.src = ''; reject(new Error('The video could not be inspected. Choose a valid MP4 video and try again.')) }, 15000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      window.clearTimeout(timer)
      const metadata = { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
      video.src = ''
      if (!Number.isFinite(metadata.duration) || metadata.width < 1 || metadata.height < 1) reject(new Error('The selected MP4 is missing readable video metadata.'))
      else resolve(metadata)
    }
    video.onerror = () => { window.clearTimeout(timer); video.src = ''; reject(new Error('The selected file is not a valid or supported MP4 video.')) }
    video.src = url
    video.load()
  })
}

export default function ReportIssue() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [image, setImage] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [imageSource, setImageSource] = useState('')
  const [imageError, setImageError] = useState('')
  const [imageWarning, setImageWarning] = useState('')
  const [validatingPhoto, setValidatingPhoto] = useState(false)
  const [video, setVideo] = useState(null)
  const [videoPreview, setVideoPreview] = useState('')
  const [videoMetadata, setVideoMetadata] = useState(null)
  const [videoError, setVideoError] = useState('')
  const [videoWarning, setVideoWarning] = useState('')
  const [validatingVideo, setValidatingVideo] = useState(false)
  const [photoMetadata, setPhotoMetadata] = useState(null)
  const [imageDimensions, setImageDimensions] = useState(null)
  const [deviceGps, setDeviceGps] = useState(null)
  useEffect(() => { if (!image) { setImagePreview(''); return undefined }; const url = URL.createObjectURL(image); setImagePreview(url); return () => URL.revokeObjectURL(url) }, [image])
  useEffect(() => () => { if (videoPreview) URL.revokeObjectURL(videoPreview) }, [videoPreview])
  const [location, setLocation] = useState(null)
  const [locationName, setLocationName] = useState('')
  const [mapZoom, setMapZoom] = useState(13)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [locating, setLocating] = useState(false)
  const [searchingAddress, setSearchingAddress] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionMessage, setSuggestionMessage] = useState('')
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const skipSuggestionQuery = useRef(false)

  const selectPhoto = async (file, source) => {
    setImageError('')
    setImageWarning('')
    setPhotoMetadata(null)
    setImageDimensions(null)
    if (!file) return
    setValidatingPhoto(true)
    setImage(null)
    setImageSource('')
    if (file.size > PHOTO_UPLOAD.maxBytes) {
      setImageError('Your photo is larger than 5 MB. Please choose a smaller image or compress it before uploading.')
      setValidatingPhoto(false)
      return
    }
    const detected = await detectImageFormat(file).catch(() => null)
    const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
    const mimeFormats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }
    if (!detected || !detected.extension.includes(extension) || (file.type && mimeFormats[file.type] !== detected.format)) {
      setImageError('Choose a valid JPG, JPEG, PNG, or WebP photo. The file content must match its format.')
      setValidatingPhoto(false)
      return
    }
    const previewUrl = URL.createObjectURL(file)
    try {
      const dimensions = await probeImage(previewUrl)
      setImage(file)
      setImageDimensions(dimensions)
      setImageSource(source)
      if (dimensions.width < PHOTO_UPLOAD.minWidth || dimensions.height < PHOTO_UPLOAD.minHeight) {
        setImageWarning('This photo has a low resolution. For clearer evidence, we recommend an image of at least 1280 × 720 pixels. You can still use this photo.')
      }
      try {
        setPhotoMetadata(await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'Make', 'Model'] }))
      } catch { setPhotoMetadata(null) }
    } catch (error) {
      setImageError(error.message || 'This photo could not be opened. Choose another image.')
    } finally {
      URL.revokeObjectURL(previewUrl)
      setValidatingPhoto(false)
    }
  }

  const selectVideo = async (file) => {
    setVideoError('')
    setVideoWarning('')
    setVideoMetadata(null)
    if (!file) return
    setValidatingVideo(true)
    setVideo(null)
    setVideoPreview('')
    if (file.size > VIDEO_UPLOAD.maxBytes) {
      setVideoError('Your video exceeds the 50 MB limit. Please choose a smaller video. If needed, export a shorter clip at a lower bitrate while keeping its original aspect ratio.')
      setValidatingVideo(false)
      return
    }
    const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
    let signature
    try { signature = new Uint8Array(await file.slice(0, 12).arrayBuffer()) } catch {
      setVideoError('This video could not be inspected. Choose another MP4 file.')
      setValidatingVideo(false)
      return
    }
    const isMp4 = signature.length >= 12 && String.fromCharCode(...signature.slice(4, 8)) === 'ftyp'
    if (extension !== '.mp4' || !isMp4 || (file.type && file.type !== 'video/mp4')) {
      setVideoError('Choose a valid MP4 video. The file content must be MP4, regardless of its filename.')
      setValidatingVideo(false)
      return
    }
    const previewUrl = URL.createObjectURL(file)
    try {
      const metadata = await probeVideo(previewUrl)
      if (metadata.duration > VIDEO_UPLOAD.maxDurationSeconds) {
        setVideoError('Your video is longer than 60 seconds. Please upload a shorter video.')
        URL.revokeObjectURL(previewUrl)
        setValidatingVideo(false)
        return
      }
      setVideo(file)
      setVideoPreview(previewUrl)
      setVideoMetadata(metadata)
      if (metadata.width < VIDEO_UPLOAD.minWidth || metadata.height < VIDEO_UPLOAD.minHeight) {
        setVideoWarning('This video has a low resolution. For clearer evidence, we recommend 1280 × 720 or higher. You can still use this video.')
      }
    } catch (error) {
      setVideoError(error.message || 'This video could not be inspected. Choose another MP4.')
      URL.revokeObjectURL(previewUrl)
      setValidatingVideo(false)
      return
    }
    setValidatingVideo(false)
  }

  const removeVideo = () => {
    setVideo(null)
    setVideoPreview('')
    setVideoMetadata(null)
    setVideoError('')
    setVideoWarning('')
  }

  useEffect(() => {
    const query = address.trim()
    if (skipSuggestionQuery.current) {
      skipSuggestionQuery.current = false
      setSuggestions([])
      setSuggestionMessage('')
      setSuggestionsLoading(false)
      return undefined
    }
    if (query.length < 2) {
      setSuggestions([])
      setSuggestionMessage('')
      setSuggestionsLoading(false)
      return undefined
    }

    const controller = new AbortController()
    let isCurrent = true
    const timer = setTimeout(async () => {
      setSuggestionsLoading(true)
      setSuggestionMessage('')
      try {
        const params = new URLSearchParams({ q: query, limit: '5', lang: 'en' })
        const response = await fetch(`${GEOCODING_URL}?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Place search is temporarily unavailable. Try again or choose a point on the map.')
        const data = await response.json()
        if (!isCurrent) return
        const results = (data.features || []).filter((feature) => getFeatureLocation(feature))
        setSuggestions(results)
        setActiveSuggestion(0)
        setSuggestionMessage(results.length ? '' : 'No matching places found. Try a more specific search.')
      } catch (err) {
        if (!isCurrent || err.name === 'AbortError') return
        setSuggestions([])
        setSuggestionMessage(err.message || 'Could not search places. Check your connection and try again.')
      } finally {
        if (isCurrent) setSuggestionsLoading(false)
      }
    }, 600)

    return () => {
      isCurrent = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [address])

  const selectFeature = (feature) => {
    const point = getFeatureLocation(feature)
    if (!point) {
      setError('That result did not include usable map coordinates. Try another result.')
      return false
    }
    const label = getFeatureLabel(feature)
    skipSuggestionQuery.current = true
    setAddress(label)
    setLocation(point)
    setDeviceGps(null)
    setLocationName(label)
    setMapZoom(getFeatureZoom(feature))
    setSuggestions([])
    setSuggestionMessage('')
    setError('')
    return true
  }

  const searchAddress = async () => {
    const query = address.trim()
    if (!query) {
      setError('Enter a city, address, landmark, or place to search.')
      return null
    }
    setSearchingAddress(true)
    setError('')
    try {
      const params = new URLSearchParams({ q: query, limit: '5', lang: 'en' })
      const response = await fetch(`${GEOCODING_URL}?${params}`)
      if (!response.ok) throw new Error('Place search is temporarily unavailable. Try again or choose a point on the map.')
      const data = await response.json()
      const result = (data.features || []).find((feature) => getFeatureLocation(feature))
      if (!result) throw new Error('Location not found. Try a more specific place name or choose a point on the map.')
      if (selectFeature(result)) return getFeatureLocation(result)
      return null
    } catch (err) {
      setError(err.message || 'Could not search places. Check your connection and try again.')
      return null
    } finally {
      setSearchingAddress(false)
    }
  }

  const handleSearchKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setActiveSuggestion((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Escape') {
      setSuggestions([])
      setSuggestionMessage('')
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (suggestions.length) selectFeature(suggestions[activeSuggestion] || suggestions[0])
      else searchAddress()
    }
  }

  const useCurrentLocation = () => {
    setError('')
    if (!navigator.geolocation) {
      setError('This browser does not support location. Select the location on the map instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        setLocation(point)
        setLocationName('Current location')
        setDeviceGps(point)
        setMapZoom(16)
        setLocating(false)
      },
      () => {
        setError('Location permission was not granted. Select the location on the map instead.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (validatingPhoto || validatingVideo) return
    if (!image) {
      setImageError('A photo is required to submit a complaint. Choose a JPG, PNG, or WebP image first.')
      return
    }
    if (!video) {
      setVideoError('A video is required to submit a complaint. Choose an MP4 video first.')
      return
    }
    if (!address.trim()) {
      setError('Enter the address or place where the problem occurred.')
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')

    let submissionLocation = location
    if (!submissionLocation && address.trim()) {
      submissionLocation = await searchAddress()
    }
    if (!submissionLocation) {
      setLoading(false)
      return
    }
    if (!Number.isFinite(submissionLocation.lat) || !Number.isFinite(submissionLocation.lng)
      || submissionLocation.lat < -90 || submissionLocation.lat > 90 || submissionLocation.lng < -180 || submissionLocation.lng > 180) {
      setError('Choose a valid location on the map or enter a place that can be found.')
      setLoading(false)
      return
    }

    const formData = new FormData()
    formData.append('title', title)
    formData.append('description', description)
    formData.append('latitude', submissionLocation.lat)
    formData.append('longitude', submissionLocation.lng)
    formData.append('photo_source', imageSource || '')
    if (deviceGps) { formData.append('device_gps_latitude', deviceGps.lat); formData.append('device_gps_longitude', deviceGps.lng) }
    if (address) formData.append('address', address)
    if (image) formData.append('image', image, image.name || 'report-photo.jpg')
    if (video) formData.append('video', video, video.name || 'report-video.mp4')

    try {
      await api.createComplaint(formData)
      setSuccess('Complaint submitted successfully. Available photo metadata will be shown to reviewers as supporting evidence only.')
      setTimeout(() => navigate('/my-complaints'), 1500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 800 }}>
      <div className="page-header">
        <h1>Report an Issue</h1>
        <p>Describe the civic problem with a photo and location</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="form-group">
            <label htmlFor="issue-title">Title</label>
            <input id="issue-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Large pothole on Main Street" minLength={3} maxLength={200} required />
          </div>
          <div className="form-group">
            <label htmlFor="issue-description">Description</label>
            <textarea
              id="issue-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue in detail. Include severity keywords like 'urgent' or 'dangerous' for priority."
              minLength={10}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="issue-image-camera">Photo evidence *</label>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Required: attach a JPG, JPEG, PNG, or WebP photo up to 5 MB. Recommended: 1280 × 720 minimum; 1920 × 1080 preferred. Photos keep their original aspect ratio.</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label htmlFor="issue-image-camera" className="btn btn-outline">Take a photo
                <input id="issue-image-camera" type="file" accept={PHOTO_UPLOAD.accept} capture="environment" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={(event) => { selectPhoto(event.target.files?.[0], 'camera_picker'); event.target.value = '' }} />
              </label>
              <label htmlFor="issue-image-gallery" className="btn btn-outline">Choose from gallery
                <input id="issue-image-gallery" type="file" accept={PHOTO_UPLOAD.accept} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={(event) => { selectPhoto(event.target.files?.[0], 'gallery'); event.target.value = '' }} />
              </label>
            </div>
            {imageError && <p className="error-msg" role="alert">{imageError}</p>}
            {validatingPhoto && <p role="status">Checking photo type and dimensions…</p>}
            {imageWarning && <p role="status" style={{ color: '#8a5a00', fontSize: '0.85rem' }}>{imageWarning}</p>}
            {image && <div className="complaint-upload-preview"><img src={imagePreview} alt="Selected issue evidence preview" /><p><strong>{image.name}</strong><br />{formatFileSize(image.size)} · {imageSource === 'camera_picker' ? 'Camera picker' : 'Gallery picker'} · {imageDimensions ? `${imageDimensions.width} × ${imageDimensions.height} px` : 'Dimensions unavailable'} · {photoMetadata && Object.keys(photoMetadata).length > 0 ? 'EXIF metadata found' : 'EXIF metadata unavailable'}</p><button type="button" className="btn btn-outline" onClick={() => { setImage(null); setImageSource(''); setPhotoMetadata(null); setImageDimensions(null); setImageError(''); setImageWarning('') }}>Remove photo</button></div>}
            {!image && <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>Attach a clear photo to continue. Camera picker selection does not prove authenticity or capture time.</p>}
          </div>
          <div className="form-group">
            <label htmlFor="issue-video">Video evidence *</label>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>Required: attach an MP4 video up to 50 MB and 60 seconds. Recommended: 1280 × 720 minimum; 1920 × 1080 preferred. Keep the original aspect ratio; H.264 video and AAC audio are preferred.</p>
            <input id="issue-video" type="file" accept={VIDEO_UPLOAD.accept} onChange={(event) => { selectVideo(event.target.files?.[0]); event.target.value = '' }} />
            {videoError && <p className="error-msg" role="alert">{videoError}</p>}
            {validatingVideo && <p role="status">Checking video type, duration, and dimensions…</p>}
            {videoWarning && <p role="status" style={{ color: '#8a5a00', fontSize: '0.85rem' }}>{videoWarning}</p>}
            {video && <div className="complaint-upload-preview complaint-video-preview"><video src={videoPreview} controls playsInline preload="metadata" aria-label="Review selected issue video" /><p><strong>{video.name}</strong><br />{formatFileSize(video.size)} · {videoMetadata?.width} × {videoMetadata?.height} px · {videoMetadata ? `${Math.floor(videoMetadata.duration / 60)}:${String(Math.floor(videoMetadata.duration % 60)).padStart(2, '0')} duration` : 'Reading video details…'}</p><button type="button" className="btn btn-outline" onClick={removeVideo}>Remove video</button></div>}
          </div>
          <div className="form-group">
            <label htmlFor="issue-location-search">Address or place *</label>
            <div className="location-search-wrap">
              <div className="location-search-row">
                <input
                  id="issue-location-search"
                  type="search"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestionsLoading || suggestions.length > 0}
                  aria-controls="location-suggestions"
                  aria-activedescendant={suggestions.length ? `location-suggestion-${activeSuggestion}` : undefined}
                  value={address}
                  required
                  maxLength={300}
                  onChange={(e) => {
                    setAddress(e.target.value)
                    setLocation(null)
                    setDeviceGps(null)
                    setLocationName('')
                    setSuggestions([])
                    setSuggestionMessage('')
                    setActiveSuggestion(0)
                    setError('')
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search a city, country, address, or landmark"
                />
                <button type="button" className="btn btn-outline location-search-button" onClick={searchAddress} disabled={searchingAddress || !address.trim()}>
                  {searchingAddress ? 'Searching…' : 'Find location'}
                </button>
              </div>
              {(suggestionsLoading || suggestions.length > 0 || suggestionMessage) && (
                <div className="location-suggestions" id="location-suggestions" role="listbox" aria-label="Location suggestions">
                  {suggestionsLoading && <div className="location-search-status" role="status">Searching places…</div>}
                  {suggestions.map((feature, index) => {
                    const label = getFeatureLabel(feature)
                    const point = getFeatureLocation(feature)
                    return (
                      <button
                        type="button"
                        id={`location-suggestion-${index}`}
                        key={`${feature.properties?.osm_type || ''}-${feature.properties?.osm_id || ''}-${point.lat}-${point.lng}`}
                        className={`location-suggestion${index === activeSuggestion ? ' is-active' : ''}`}
                        role="option"
                        aria-selected={index === activeSuggestion}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectFeature(feature)}
                      >
                        <span className="location-suggestion-name">{label}</span>
                        <span className="location-suggestion-type">{feature.properties?.type || feature.properties?.osm_value || 'Place'}</span>
                      </button>
                    )
                  })}
                  {!suggestionsLoading && suggestionMessage && <div className="location-search-status" role="status">{suggestionMessage}</div>}
                </div>
              )}
            </div>
            <p className="location-search-hint" aria-live="polite">
              {suggestionsLoading ? 'Searching for matching places…' : 'Type at least 2 characters; use arrow keys and Enter to choose a result.'}
            </p>
          </div>
        </div>

        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>Issue Location</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Choose a search suggestion, click the map, drag the marker, or use your current location.
          </p>
          <MapView
            center={location ? [location.lat, location.lng] : [19.076, 72.8777]}
            zoom={mapZoom}
            markers={location ? [{
              id: 'selected-issue-location',
              lat: location.lat,
              lng: location.lng,
              popup: locationName || 'Selected issue location',
              draggable: true,
              onDrag: (lat, lng) => {
                setLocation({ lat, lng })
                setDeviceGps(null)
              setLocationName('')
              },
            }] : []}
            onMapClick={(lat, lng) => {
              setLocation({ lat, lng })
              setDeviceGps(null)
              setLocationName('')
              setMapZoom(16)
            }}
          />
          <button type="button" className="btn btn-outline" style={{ marginTop: '0.75rem' }} onClick={useCurrentLocation} disabled={locating}>
            {locating ? 'Getting location…' : 'Use my current location'}
          </button>
          {location ? (
            <p style={{ marginTop: '0.75rem', fontSize: '0.875rem' }} aria-live="polite">
              {locationName && <><strong>Selected place:</strong> {locationName}<br /></>}
              Coordinates: {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </p>
          ) : (
            <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--muted)' }}>Select a location on the map or search for a place to continue.</p>
          )}
        </div>

        {error && <p className="error-msg" role="alert">{error}</p>}
        {success && <p className="success-msg" role="status">{success}</p>}

        <button type="submit" className="btn btn-primary" disabled={loading || searchingAddress || validatingPhoto || validatingVideo || !image || !video || !address.trim()}>
          {loading ? 'Submitting & Analyzing...' : 'Submit Complaint'}
        </button>
      </form>
    </div>
  )
}




