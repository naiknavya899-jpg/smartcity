import { useEffect, useRef, useState } from 'react'
import StatusBadge from './StatusBadge'
import PriorityBadge from './PriorityBadge'
import MapView from './MapView'
import { api } from '../services/api'

function AdminActions({ complaint, onUpdate, onSelect }) {
  const [notes, setNotes] = useState(complaint.admin_notes || '')
  const [team, setTeam] = useState(complaint.assigned_team || '')
  const [reviewed, setReviewed] = useState(false)
  const [points, setPoints] = useState([])
  const imageRef = useRef(null)
  useEffect(() => { setNotes(complaint.admin_notes || ''); setTeam(complaint.assigned_team || '') }, [complaint.id, complaint.admin_notes, complaint.assigned_team])
  const markPoint = (event) => {
    const image = imageRef.current
    if (!image) return
    const box = event.currentTarget.getBoundingClientRect()
    setPoints((current) => [...current, [
      Math.round((event.clientX - box.left) / box.width * image.naturalWidth),
      Math.round((event.clientY - box.top) / box.height * image.naturalHeight),
    ]])
  }
  const saveOutline = () => {
    if (points.length < 3) return
    const width = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]))
    const height = Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]))
    const entry = 'Pothole boundary marked in source-image pixels: ' + width + ' × ' + height + ' px. Points: ' + points.map((p) => p.join(',')).join('; ')
    onUpdate?.(complaint.id, { admin_notes: [notes, entry].filter(Boolean).join('\n') })
  }
  return (
    <div className="admin-review-tools" id="assignment">
      <button className="btn btn-outline" onClick={() => onSelect?.(complaint)}>Show issue on map</button>
      <label>Municipal team <input value={team} maxLength="120" onChange={(e) => setTeam(e.target.value)} placeholder="Team name" /></label>
      <button className="btn btn-outline" onClick={() => onUpdate?.(complaint.id, { assigned_team: team })}>Save team assignment</button>
      {complaint.category === 'pothole' && complaint.image_path && <div className="admin-pothole-annotation" id="pothole">
        <b>Pothole outline · source image pixels</b>
        <div className="admin-annotation-frame" onClick={markPoint}>
          <img ref={imageRef} src={'/uploads/' + encodeURIComponent(complaint.image_path)} alt="Click around the pothole boundary" />
          <svg viewBox={'0 0 ' + (imageRef.current?.naturalWidth || 1) + ' ' + (imageRef.current?.naturalHeight || 1)} preserveAspectRatio="none"><polygon points={points.map((point) => point.join(',')).join(' ')} /></svg>
        </div>
        <small>Mark three or more points, then save. Physical dimensions require image scale calibration and are unavailable here.</small>
        <button className="btn btn-outline" onClick={() => setPoints([])}>Clear outline</button>
        <button className="btn btn-outline" disabled={points.length < 3} onClick={saveOutline}>Save pixel annotation</button>
      </div>}
      <label>Admin review note <textarea value={notes} maxLength="2000" rows="3" onChange={(e) => setNotes(e.target.value)} placeholder="Record decision or missing evidence" /></label>
      <label className="admin-review-confirm"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the available evidence.</label>
      <div className="admin-review-buttons">
        <button disabled={!reviewed || !notes.trim()} onClick={() => onUpdate?.(complaint.id, { status: 'in_progress', admin_notes: notes.trim() })}>Confirm issue</button>
        <button disabled={!notes.trim()} onClick={() => onUpdate?.(complaint.id, { admin_notes: notes.trim() })}>Request more evidence</button>
        <button disabled={!notes.trim()} onClick={() => onUpdate?.(complaint.id, { status: 'rejected', admin_notes: notes.trim() })}>Reject report</button>
      </div>
      <small>Confirmation sets the report to In Progress. Evidence requests are saved as private admin notes and are not sent to citizens; assignments do not dispatch teams.</small>
    </div>
  )
}

function ComplaintEvidence({ complaint }) {
  const [photoAvailable, setPhotoAvailable] = useState(Boolean(complaint.image_path))
  const [videoAvailable, setVideoAvailable] = useState(Boolean(complaint.video_path))
  return (photoAvailable || videoAvailable || (!complaint.image_path && !complaint.video_path)) ? (
    <section className="complaint-evidence" aria-label="Complaint evidence">
      <h4>Submitted evidence</h4>
      {photoAvailable && <div><a href={`/uploads/${encodeURIComponent(complaint.image_path)}`} target="_blank" rel="noreferrer"><img src={`/uploads/${encodeURIComponent(complaint.image_path)}`} alt={`Full evidence photo for complaint ${complaint.id}`} onError={() => setPhotoAvailable(false)} /></a><p>Photo · {complaint.image_width && complaint.image_height ? `${complaint.image_width} × ${complaint.image_height} px` : 'resolution unavailable'}</p></div>}
      {videoAvailable && <div><video src={`/uploads/${encodeURIComponent(complaint.video_path)}`} controls playsInline preload="metadata" aria-label={`Evidence video for complaint ${complaint.id}`} onError={() => setVideoAvailable(false)} /><p>Video · {complaint.video_width && complaint.video_height ? `${complaint.video_width} × ${complaint.video_height} px` : 'resolution unavailable'}{complaint.video_duration_seconds ? ` · ${Math.floor(complaint.video_duration_seconds / 60)}:${String(Math.floor(complaint.video_duration_seconds % 60)).padStart(2, '0')}` : ''}</p></div>}
      {!photoAvailable && !videoAvailable && <p>Evidence is unavailable.</p>}
    </section>
  ) : <p className="complaint-evidence-unavailable">Evidence is unavailable.</p>
}

export default function ComplaintCard({ complaint, admin = false, onUpdate, onSelect, initiallyOpen = false }) {
  const [detailsOpen, setDetailsOpen] = useState(initiallyOpen)
  const [earthEngineLayer, setEarthEngineLayer] = useState({ loading: false, available: false })
  useEffect(() => setDetailsOpen(initiallyOpen), [initiallyOpen])
  const formatCategory = (cat) => cat?.replace(/_/g, ' ') || 'other'
  const hasLocation = complaint.latitude != null && complaint.longitude != null
    && Number.isFinite(Number(complaint.latitude)) && Number.isFinite(Number(complaint.longitude))
    && Number(complaint.latitude) >= -90 && Number(complaint.latitude) <= 90
    && Number(complaint.longitude) >= -180 && Number(complaint.longitude) <= 180
  const coordinates = hasLocation ? `${Number(complaint.latitude)},${Number(complaint.longitude)}` : ''
  const isWaterLeak = complaint.category === 'water_leakage'

  useEffect(() => {
    if (!detailsOpen || !admin || !isWaterLeak || !hasLocation) {
      setEarthEngineLayer({ loading: false, available: false })
      return undefined
    }
    let active = true
    setEarthEngineLayer({ loading: true, available: false })
    api.getGeeOverlay(Number(complaint.latitude), Number(complaint.longitude))
      .then((result) => { if (active) setEarthEngineLayer({ loading: false, ...result }) })
      .catch((error) => {
        if (active) setEarthEngineLayer({ loading: false, available: false, message: error.message })
      })
    return () => { active = false }
  }, [detailsOpen, admin, isWaterLeak, hasLocation, complaint.latitude, complaint.longitude])

  return (
    <div className="card complaint-item" id={`complaint-${complaint.id}`}>
      {complaint.image_path && (
        <img src={`/uploads/${encodeURIComponent(complaint.image_path)}`} alt={complaint.title} onError={(event) => { event.currentTarget.hidden = true }} />
      )}
      <div style={{ flex: 1 }}>
        <h3 style={{ marginBottom: '0.25rem' }}>{complaint.title}</h3>
        <div className="complaint-meta">
          <StatusBadge status={complaint.status} />
          <PriorityBadge priority={complaint.priority} />
          <span>Category: {formatCategory(complaint.category)}</span>
          <span>Dept: {complaint.department}</span>
          <span>Submitted: {new Date(complaint.created_at).toLocaleString()}</span>
        </div>

        <button
          type="button"
          className="complaint-expand-button"
          aria-expanded={detailsOpen}
          aria-controls={`complaint-details-${complaint.id}`}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? 'Hide problem details' : 'View problem details'}
          <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
        </button>

        {detailsOpen && <div id={`complaint-details-${complaint.id}`} className="complaint-expanded-details">
          <p className="complaint-description">{complaint.description || 'No description provided.'}</p>
          <ComplaintEvidence complaint={complaint} />
          <div className="complaint-meta complaint-meta-extra">
            {complaint.ai_confidence != null && <span>AI confidence: {(complaint.ai_confidence * 100).toFixed(0)}%</span>}
            <span>Last updated: {new Date(complaint.updated_at || complaint.created_at).toLocaleString()}</span>
          </div>
          <div style={{ marginTop: '0.5rem', color: 'var(--muted)' }}>
            <p>Complaint #{complaint.id} Â· {formatCategory(complaint.category)} Â· {complaint.status.replace(/_/g, ' ')}</p>
            {complaint.address && <p>Address: {complaint.address}</p>}
            {hasLocation ? (
              <>
                <p>Coordinates: {Number(complaint.latitude).toFixed(6)}, {Number(complaint.longitude).toFixed(6)}</p>
                {detailsOpen && (
                  <>
                    <MapView
                      center={[Number(complaint.latitude), Number(complaint.longitude)]}
                      zoom={isWaterLeak && earthEngineLayer.available ? earthEngineLayer.satellite_max_zoom : 15}
                      maxZoom={earthEngineLayer.available ? earthEngineLayer.satellite_max_zoom : 19}
                      satelliteMaxZoom={earthEngineLayer.available ? earthEngineLayer.satellite_max_zoom : 14}
                      satelliteTileUrl={isWaterLeak && earthEngineLayer.available ? earthEngineLayer.tile_url : ''}
                      waterTileUrl={isWaterLeak && earthEngineLayer.available ? earthEngineLayer.water_tile_url : ''}
                      height="280px"
                      markers={[{
                        id: `complaint-${complaint.id}`,
                        lat: Number(complaint.latitude),
                        lng: Number(complaint.longitude),
                        popup: `Complaint #${complaint.id} Â· ${formatCategory(complaint.category)} Â· ${complaint.status.replace(/_/g, ' ')}`,
                      }]}
                    />
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`} target="_blank" rel="noreferrer">
                      View on Map
                    </a>
                    {admin && isWaterLeak && <p className="complaint-earth-engine-status" role="status">
                      {earthEngineLayer.loading
                        ? 'Loading Earth Engine satellite imagery at this report location…'
                        : earthEngineLayer.available
                          ? `Earth Engine satellite imagery · ${earthEngineLayer.start_date} to ${earthEngineLayer.end_date}. Cyan shows possible surface water (${earthEngineLayer.water_resolution_m} m pixels); verify suspected leaks in the field.`
                          : `Earth Engine imagery unavailable. ${earthEngineLayer.message || 'Showing the standard map.'}`}
                    </p>}
                  </>
                )}
              </>
            ) : <p>Location not available</p>}
          </div>

        {admin && (
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <select
              value={complaint.status}
              onChange={(e) => onUpdate?.(complaint.id, { status: e.target.value })}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              {complaint.status === 'rejected' && <option value="rejected" disabled>Rejected (existing record)</option>}
            </select>
            <select
              value={complaint.priority}
              onChange={(e) => onUpdate?.(complaint.id, { priority: e.target.value })}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        )}

        {admin && <AdminActions complaint={complaint} onUpdate={onUpdate} onSelect={onSelect} />}

        {complaint.status_history?.length > 0 && (
          <details className="complaint-history">
            <summary>Status history</summary>
            <ul>
              {complaint.status_history.map((h) => (
                <li key={h.id}>
                  <StatusBadge status={h.status} /> — {new Date(h.changed_at).toLocaleString()}{admin && h.note ? ' · ' + h.note : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
        </div>}
      </div>
    </div>
  )
}





