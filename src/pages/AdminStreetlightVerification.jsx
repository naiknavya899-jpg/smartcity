import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import './AdminStreetlightVerification.css'

const ExistingAdminAnalysis = lazy(() => import('./AdminDashboard'))

const statusLabels = {
  pending: 'Pending verification', in_progress: 'In progress', confirmed_fault: 'Confirmed fault',
  field_inspection_required: 'Field inspection required', more_evidence_required: 'More evidence required',
  resolved: 'Resolved', rejected: 'Rejected',
}
const actionLabels = {
  report_submitted: 'Report submitted', fault_confirmed: 'Fault confirmed', inspection_requested: 'Field inspection requested',
  more_evidence_requested: 'More evidence requested', issue_resolved: 'Issue marked resolved', report_rejected: 'Report rejected',
  metadata_checked: 'Metadata reviewed', visual_assessment: 'Manual visual assessment recorded',
  status_changed: 'Status changed', admin_note: 'Admin note recorded',
}
function validPoint(lat, lon) {
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return false
  const a = Number(lat), b = Number(lon)
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180
}
function distanceMeters(aLat, aLon, bLat, bLon) {
  const rad = (n) => n * Math.PI / 180
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
function dateValue(raw) {
  if (!raw) return null
  const normalized = String(raw).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
function displayDate(value) {
  return value ? new Date(value).toLocaleString() : 'Unavailable'
}

export default function AdminStreetlightVerification() {
  const routeLocation = useLocation()
  const { logout, user } = useAuth()
  const [view, setView] = useState('dashboard')
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [team, setTeam] = useState('')
  const [visualAssessment, setVisualAssessment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const all = await api.getAdminComplaints()
      setReports(all)
      setError('')
    } catch (e) { setError(e.message || 'Unable to load streetlight reports.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (["#dashboard", "#analysis", "#map", "#analytics", "#complaints"].includes(routeLocation.hash)) setView('dashboard')
  }, [routeLocation.hash])

  const sectionReports = reports.filter((report) => {
    if (view === 'streetlight') return report.category === 'streetlight'
    if (view === 'pothole') return report.category === 'pothole'
    if (view === 'other') return !['streetlight', 'pothole'].includes(report.category)
    if (view === 'assigned') return Boolean(report.assigned_team)
    return true
  })
  const summary = useMemo(() => ({
    total: sectionReports.length,
    pending: sectionReports.filter((r) => ['pending', 'in_progress'].includes(r.status)).length,
    confirmed: sectionReports.filter((r) => r.status === 'confirmed_fault').length,
    inspection: sectionReports.filter((r) => r.status === 'field_inspection_required').length,
    resolved: sectionReports.filter((r) => r.status === 'resolved').length,
  }), [sectionReports])
  const filtered = useMemo(() => reports.filter((item) => {
    const categoryMatch = view === 'all' || view === 'assigned' || (view === 'streetlight' && item.category === 'streetlight') || (view === 'pothole' && item.category === 'pothole') || (view === 'other' && !['streetlight', 'pothole'].includes(item.category))
    const assignedMatch = view !== 'assigned' || Boolean(item.assigned_team)
    if (!categoryMatch || !assignedMatch) return false
    const text = [item.id, item.title, item.description, item.address].filter(Boolean).join(' ').toLowerCase()
    const submitted = new Date(item.created_at)
    return (!query || text.includes(query.trim().toLowerCase()))
      && (!status || item.status === status)
      && (!dateFrom || submitted >= new Date(`${dateFrom}T00:00:00`))
      && (!dateTo || submitted < new Date(`${dateTo}T23:59:59.999`))
  }), [reports, query, status, dateFrom, dateTo, view])
  const selected = reports.find((r) => r.id === selectedId) || null

  const goToDashboard = () => {
    setView('dashboard')
    setQuery('')
    setStatus('')
    setDateFrom('')
    setDateTo('')
    setSelectedId(null)
    setAction('')
    setNote('')
    setTeam('')
    setConfirmed(false)
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const chooseAction = (next) => { setAction(next); setNote(''); setTeam(''); setConfirmed(false); setMessage('') }
  const submitAction = async (event) => {
    event.preventDefault()
    if (!selected) return
    if (['confirm_fault', 'reject'].includes(action) && !confirmed) return
    const payload = { verification_action: action, event_note: note.trim(), admin_notes: note.trim() }
    if (action === 'request_inspection') payload.assigned_team = team.trim()
    if (action === 'confirm_fault') payload.status = 'confirmed_fault'
    if (action === 'request_inspection') payload.status = 'field_inspection_required'
    if (action === 'request_evidence') payload.status = 'more_evidence_required'
    if (action === 'reject') payload.status = 'rejected'
    if (action === 'mark_resolved') payload.status = 'resolved'
    if (action === 'visual_assessment') payload.event_note = `${visualAssessment}: ${note.trim()}`
    setSaving(true); setError(''); setMessage('')
    try {
      const updated = await api.updateComplaint(selected.id, payload)
      setReports((current) => current.map((r) => r.id === updated.id ? updated : r))
      setAction(''); setNote(''); setTeam(''); setConfirmed(false)
      setMessage('Review action saved to report history.')
    } catch (e) { setError(e.message || 'Could not save the review action.') }
    finally { setSaving(false) }
  }

  const capture = dateValue(selected?.photo_datetime_original || selected?.photo_create_date)
  const submitted = selected?.created_at ? new Date(selected.created_at) : null
  const timeReview = capture && submitted
    ? (Math.abs(capture.getTime() - submitted.getTime()) > 24 * 60 * 60 * 1000 ? 'Difference over 24 hours; review the source and timezone.' : 'No discrepancy over 24 hours detected; EXIF timezone is unavailable.')
    : 'Unable to determine from available timestamps.'
  const exifGps = selected && validPoint(selected.photo_gps_latitude, selected.photo_gps_longitude)
  const reportedGps = selected && validPoint(selected.latitude, selected.longitude)
  const deviceGps = selected && validPoint(selected.device_gps_latitude, selected.device_gps_longitude)

  return <div className="streetlight-shell">
    <aside className="streetlight-sidebar"><Link to="/admin#dashboard" className="streetlight-brand"><img className="streetlight-logo-mark" src="/images/urban-eye-logo-mark.png" alt="Urban Eye location and city logo" /><b>Urban <i>Eye</i></b><small>See It. Report It. Improve It.</small></Link>
      <nav aria-label="Admin navigation"><button className={view === 'dashboard' ? 'active' : ''} onClick={goToDashboard}>Dashboard</button><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All Reports</button><button className={view === 'streetlight' ? 'active' : ''} onClick={() => setView('streetlight')}>Streetlight Verification</button><button className={view === 'pothole' ? 'active' : ''} onClick={() => setView('pothole')}>Pothole Verification</button><button className={view === 'other' ? 'active' : ''} onClick={() => setView('other')}>Other Civic Issues</button><button className={view === 'assigned' ? 'active' : ''} onClick={() => setView('assigned')}>Assigned Teams</button><Link to="/admin#analytics">Analytics</Link><Link to="/admin#map">Map &amp; Satellite Imagery</Link><Link to="/analyze">Analyze Text</Link><Link to="/profile">Settings</Link><button onClick={logout}>Logout</button></nav>
    <div className="streetlight-sidebar-footer"><svg viewBox="0 0 420 120" aria-hidden="true"><path d="M5 110h410M25 110V67h24v43m15 0V35h30v75m14 0V57h27v53m16 0V18h35v92m17 0V50h30v60m15 0V31h39v79m18 0V60h30v50m17 0V43h32v67m16 0V72h23v38" fill="none" stroke="currentColor" stroke-width="3"/></svg><p>Cleaner Cities<br/>Safer Communities<br/>A Better Tomorrow</p></div></aside>
    <main className="streetlight-main">
      <header className={`streetlight-topbar${view === 'dashboard' ? ' is-dashboard-view' : ''}`}><div><small>ADMIN CONSOLE</small><h1>{view === 'dashboard' ? 'Admin Dashboard' : view === 'all' ? 'All Reports' : view === 'pothole' ? 'Pothole Verification' : view === 'other' ? 'Other Civic Issues' : view === 'assigned' ? 'Assigned Teams' : 'Streetlight Verification'}</h1></div><div className="streetlight-top-actions"><input aria-label="Search reports" placeholder="Search reports or locations" value={query} onChange={(e) => setQuery(e.target.value)} /><button className="streetlight-history-link" onClick={() => selected ? document.querySelector(".streetlight-history")?.scrollIntoView({ behavior: "smooth" }) : document.querySelector(".streetlight-table")?.scrollIntoView({ behavior: "smooth" })} aria-label="Open report activity"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>Activity</button><span className="streetlight-admin-name">{user?.name || "Administrator"}</span><button className="streetlight-refresh" onClick={refresh} disabled={loading}>Refresh</button></div></header>
      {view === 'dashboard' ? (
        <div className="streetlight-content admin-overview-content"><Suspense fallback={<div className="streetlight-empty">Loading admin dashboard...</div>}><ExistingAdminAnalysis embedded /></Suspense></div>
      ) : (
      <section className="streetlight-content">
        <p className="streetlight-intro">Review citizen-submitted reports using original photos and available metadata. Visual assessment is manual; metadata and classification do not confirm a fault.</p>
        <div className="streetlight-stats" id="streetlight-summary" aria-label="Report summary">{[['Total Reports', summary.total], ['Pending Verification', summary.pending], ['Confirmed Faults', summary.confirmed], ['Field Inspection Required', summary.inspection], ['Resolved Reports', summary.resolved]].map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div>
        <section className="streetlight-card">
          <div className="streetlight-card-head"><div><h2>{view === 'all' ? 'All reports' : view === 'pothole' ? 'Pothole reports' : view === 'other' ? 'Other civic reports' : view === 'assigned' ? 'Assigned reports' : 'Streetlight reports'}</h2><p>Counts are derived from real records returned by the admin API.</p></div><span>{filtered.length} shown</span></div>
          <div className="streetlight-filters"><input aria-label="Search reports" placeholder="Search ID, description, location" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><label>From<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label><label>To<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label></div>
          {error && <p className="streetlight-error" role="alert">{error}</p>}{message && <p className="streetlight-success" role="status">{message}</p>}
          {loading ? <p className="streetlight-empty" role="status">Loading streetlight reports…</p> : filtered.length === 0 ? <p className="streetlight-empty">No reports match those filters.</p> : <div className="streetlight-table-wrap"><table className="streetlight-table"><thead><tr><th>Report</th><th>Photo</th><th>Description</th><th>Reported location</th><th>Capture date</th><th>Capture time</th><th>Submitted</th><th>GPS metadata</th><th>Status</th><th>Action</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} onClick={() => setSelectedId(item.id)}><td>#{item.id}</td><td>{item.image_path ? <img className="streetlight-thumb" src={`/uploads/${encodeURIComponent(item.image_path)}`} alt={`Evidence for report ${item.id}`} /> : 'No photo'}</td><td>{item.title}<small>{item.description}</small></td><td>{item.address || 'Address unavailable'}{validPoint(item.latitude, item.longitude) && <small>{Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}</small>}</td><td>{(item.photo_datetime_original || item.photo_create_date || "").split(" ")[0] || "Metadata unavailable"}</td><td>{(item.photo_datetime_original || item.photo_create_date || "").split(" ")[1] || "Metadata unavailable"}</td><td>{displayDate(item.created_at)}</td><td>{validPoint(item.photo_gps_latitude, item.photo_gps_longitude) ? 'Available' : 'Unavailable'}</td><td><span className={`streetlight-status status-${item.status}`}>{statusLabels[item.status] || item.status}</span></td><td><button onClick={(e) => { e.stopPropagation(); setSelectedId(item.id) }}>Review</button></td></tr>)}</tbody></table></div>}
        </section>
        {selected && <section className="streetlight-detail streetlight-card" aria-label={`Verification details for report ${selected.id}`}>
          <div className="streetlight-card-head"><div><h2>Report #{selected.id} · Evidence review</h2><p>{statusLabels[selected.status] || selected.status}</p></div><button onClick={() => { setSelectedId(null); setAction('') }}>Close</button></div>
          <div className="streetlight-detail-grid">
            <div><h3>Citizen report</h3><p><b>Description:</b> {selected.description}</p><p><b>Reported location:</b> {selected.address || 'Unavailable'}</p><p><b>Reported coordinates:</b> {reportedGps ? `${Number(selected.latitude).toFixed(6)}, ${Number(selected.longitude).toFixed(6)}` : 'Unavailable'}</p><p><b>Server submission time:</b> {displayDate(selected.created_at)}</p><p><b>Status:</b> {statusLabels[selected.status] || selected.status}</p>{selected.assigned_team && <p><b>Assigned team (manual entry):</b> {selected.assigned_team}</p>}</div>
            <div><h3>Original photo evidence</h3>{selected.image_path ? <><a href={`/uploads/${encodeURIComponent(selected.image_path)}`} target="_blank" rel="noreferrer"><img className="streetlight-evidence" src={`/uploads/${encodeURIComponent(selected.image_path)}`} alt={`Original citizen photo for report ${selected.id}`} onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement.nextElementSibling.hidden = false }} /></a><p hidden>Photo evidence is unavailable.</p></> : <p>No photo was attached.</p>}{selected.video_path ? <div className="streetlight-video-evidence"><h4>Original video evidence</h4><video src={`/uploads/${encodeURIComponent(selected.video_path)}`} controls playsInline preload="metadata" aria-label={`Original citizen video for report ${selected.id}`} onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling.hidden = false }} /><p hidden>Video evidence is unavailable.</p><p>{selected.video_width && selected.video_height ? `${selected.video_width} x ${selected.video_height} px` : 'Resolution unavailable'}{selected.video_duration_seconds ? ` · ${Math.floor(selected.video_duration_seconds / 60)}:${String(Math.floor(selected.video_duration_seconds % 60)).padStart(2, '0')}` : ''}</p></div> : <p>No video was attached.</p>}<p><b>Picker source:</b> {selected.photo_source === 'camera_picker' ? 'Camera picker (self-reported)' : selected.photo_source === 'gallery' ? 'Gallery picker (self-reported)' : 'Unavailable'}</p><p><b>DateTimeOriginal:</b> {selected.photo_datetime_original || 'Metadata unavailable'}</p><p><b>CreateDate:</b> {selected.photo_create_date || 'Metadata unavailable'}</p><p><b>Device:</b> {[selected.photo_make, selected.photo_model].filter(Boolean).join(' ') || 'Metadata unavailable'}</p></div>
            <div><h3>Timestamp review</h3><p><b>Photo capture time:</b> {selected.photo_datetime_original || selected.photo_create_date || 'Unavailable'}</p><p><b>Backend submission time:</b> {displayDate(selected.created_at)}</p><p><b>Review:</b> {timeReview}</p><p className="streetlight-disclaimer">Photo metadata provides supporting evidence only and does not independently prove when or where the photo was taken. EXIF may be missing, modified, or incorrect.</p></div>
            <div><h3>Location evidence</h3><p><b>Citizen-selected report location:</b> {reportedGps ? `${Number(selected.latitude).toFixed(6)}, ${Number(selected.longitude).toFixed(6)}` : 'Unavailable'}</p><p><b>Device GPS via app permission:</b> {deviceGps ? `${Number(selected.device_gps_latitude).toFixed(6)}, ${Number(selected.device_gps_longitude).toFixed(6)}` : 'Unavailable'}</p><p><b>Image EXIF GPS:</b> {exifGps ? `${Number(selected.photo_gps_latitude).toFixed(6)}, ${Number(selected.photo_gps_longitude).toFixed(6)}` : 'Unavailable'}</p>{reportedGps && exifGps && <p><b>Reported to image GPS distance:</b> {distanceMeters(Number(selected.latitude), Number(selected.longitude), Number(selected.photo_gps_latitude), Number(selected.photo_gps_longitude)).toFixed(0)} m</p>}{deviceGps && exifGps && <p><b>App GPS to image GPS distance:</b> {distanceMeters(Number(selected.device_gps_latitude), Number(selected.device_gps_longitude), Number(selected.photo_gps_latitude), Number(selected.photo_gps_longitude)).toFixed(0)} m</p>}{!deviceGps && !exifGps && <p>Location could not be verified automatically.</p>}</div>
            <div><h3>Manual visual assessment</h3><p>No automated visual fault model is available. Review the source photo manually; an unlit appearance does not establish an electrical fault.</p><label>Assessment<select value={visualAssessment} onChange={(e) => setVisualAssessment(e.target.value)}><option value="">Choose assessment</option><option>Appears unlit</option><option>Appears illuminated</option><option>Inconclusive</option><option>Manual review required</option></select></label><button className="secondary-action" disabled={!visualAssessment} onClick={() => { setAction('visual_assessment'); setNote('Visual assessment selected in the review form below.') }}>Record assessment</button></div>
            <div><h3>Evidence summary</h3><p>Photo metadata: {selected.photo_datetime_original || selected.photo_create_date || exifGps ? 'Available' : 'Unavailable'}</p><p>Timestamp consistency: {timeReview}</p><p>Location evidence: {exifGps || deviceGps ? 'Available for review' : 'Unavailable'}</p><p>Visual assessment: {selected.status_history?.find((h) => h.event_type === 'visual_assessment')?.note || 'Not assessed'}</p><p>Additional evidence: {selected.admin_notes || 'Not available'}</p><p className="streetlight-disclaimer">These are separate evidence checks, not a certainty score. Metadata does not prove the fault.</p></div>
          </div>
          <div className="streetlight-actions"><h3>Administrator decision</h3><div className="streetlight-action-buttons"><button onClick={() => chooseAction('confirm_fault')}>Confirm Fault</button><button onClick={() => chooseAction('request_inspection')}>Request Field Inspection</button><button onClick={() => chooseAction('request_evidence')}>Request More Evidence</button><button onClick={() => chooseAction('reject')}>Reject Report</button><button onClick={() => chooseAction('metadata_checked')}>Record Metadata Review</button><button onClick={() => chooseAction('mark_resolved')}>Mark Resolved</button></div>
            {action && <form onSubmit={submitAction} className="streetlight-action-form"><h4>{actionLabels[action] || action.replaceAll('_', ' ')}</h4>{action === 'request_inspection' && <label>Inspection team or inspector (enter actual assignment)<input required maxLength="120" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team name or inspector" /></label>}<label>{action === 'reject' ? 'Rejection reason' : action === 'request_evidence' ? 'Evidence requested and reason' : action === 'request_inspection' ? 'Inspection instructions' : 'Verification note'}<textarea required maxLength="2000" value={note} onChange={(e) => setNote(e.target.value)} rows="3" placeholder="Record the evidence and reason for this action" /></label>{['confirm_fault', 'reject'].includes(action) && <label className="streetlight-confirm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I reviewed the evidence and confirm this decision.</label>}<div><button className="primary-action" disabled={saving || !note.trim() || (['confirm_fault', 'reject'].includes(action) && !confirmed) || (action === 'request_inspection' && !team.trim())}>{saving ? 'Saving…' : 'Save action'}</button><button type="button" onClick={() => setAction('')}>Cancel</button></div></form>}
          </div>
          <div className="streetlight-history"><h3>Verification history</h3>{selected.status_history?.length ? <ol>{[...selected.status_history].sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at)).map((event) => <li key={event.id}><b>{actionLabels[event.event_type] || statusLabels[event.status] || event.status}</b><time>{displayDate(event.changed_at)}</time><span>{event.actor_name || 'System / actor unavailable'}{event.actor_user_id ? ` · user #${event.actor_user_id}` : ''}</span>{event.note && <p>{event.note}</p>}</li>)}</ol> : <p>No persisted history is available for this report yet.</p>}</div>
        </section>}
        <p className="streetlight-footnote">Review workflow only. Image picker source and EXIF are not tamper-proof. Confirmations require human review; missing metadata alone does not justify rejection. Field inspection, electrical testing, or maintenance records may be needed to verify a fault.</p>
      </section>
      )}
    </main>
  </div>
}










