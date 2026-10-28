import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ComplaintCard from '../components/ComplaintCard'
import MapView from '../components/MapView'
import LocationSearch from '../components/LocationSearch'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import './AdminDashboard.css'

export default function AdminDashboard({ embedded = false }) {
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [complaints, setComplaints] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [filter, setFilter] = useState({ status: '', category: '', department: '' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [satelliteLayer, setSatelliteLayer] = useState({ loading: true, available: false })
  const [selectedMapCenter, setSelectedMapCenter] = useState(null)
  const requestInFlight = useRef(false)
  const refreshQueued = useRef(false)
  const latestWaterLeakId = useRef(null)
  const loadDataRef = useRef(null)
  const location = useLocation()
  const visibleComplaints = complaints.filter((item) => !searchQuery || [item.id, item.title, item.description, item.category, item.address].filter(Boolean).join(' ').toLowerCase().includes(searchQuery.trim().toLowerCase()))

  const loadData = useCallback(async (showLoading = false) => {
    if (requestInFlight.current) {
      if (showLoading) refreshQueued.current = true
      return
    }
    requestInFlight.current = true
    if (showLoading) setLoading(true)
    try {
      const params = Object.fromEntries(
        Object.entries(filter).filter(([, v]) => v),
      )
      const [complaintsData, analyticsData] = await Promise.all([
        api.getAdminComplaints(params),
        api.getAnalytics(),
      ])
      setComplaints(complaintsData)
      setAnalytics(analyticsData)
      setLoadError('')
    } catch (err) {
      setLoadError(err.message || 'Could not refresh dashboard data.')
    } finally {
      requestInFlight.current = false
      setLoading(false)
      if (refreshQueued.current) {
        refreshQueued.current = false
        window.setTimeout(() => loadDataRef.current?.(true), 0)
      }
    }
  }, [filter.status, filter.category, filter.department])
  loadDataRef.current = loadData

  useEffect(() => {
    loadData(true)
    const intervalId = window.setInterval(() => loadData(), 4000)
    const handleFocus = () => loadData()
    window.addEventListener('focus', handleFocus)
    
  return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
    }
  }, [loadData])

  useEffect(() => {
    if (!location.hash) return undefined
    const timeoutId = window.setTimeout(() => {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
    }, 0)
    
  return () => window.clearTimeout(timeoutId)
  }, [location.hash])

  const selectMapLocation = (lat, lng) => setSelectedMapCenter([lat, lng])

  const handleUpdate = async (id, updates) => {
    try {
      await api.updateComplaint(id, updates)
      loadData()
    } catch (err) {
      alert(err.message)
    }
  }

  const locatedComplaints = complaints.filter((complaint) => complaint.latitude != null && complaint.longitude != null
    && Number.isFinite(Number(complaint.latitude)) && Number.isFinite(Number(complaint.longitude))
    && Number(complaint.latitude) >= -90 && Number(complaint.latitude) <= 90
    && Number(complaint.longitude) >= -180 && Number(complaint.longitude) <= 180)
  const latestWaterLeak = locatedComplaints.find((complaint) => complaint.category === 'water_leakage')
  useEffect(() => {
    if (!latestWaterLeak || latestWaterLeakId.current === latestWaterLeak.id) return
    latestWaterLeakId.current = latestWaterLeak.id
    setSelectedMapCenter([Number(latestWaterLeak.latitude), Number(latestWaterLeak.longitude)])
  }, [latestWaterLeak?.id])
  const firstLocatedComplaint = locatedComplaints[0]
  const recentEvents = complaints.flatMap((item) => (item.status_history || []).map((event) => ({ ...event, complaintId: item.id, title: item.title }))).sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at)).slice(0, 5)
  const mapCenter = latestWaterLeak
    ? [Number(latestWaterLeak.latitude), Number(latestWaterLeak.longitude)]
    : firstLocatedComplaint
      ? [Number(firstLocatedComplaint.latitude), Number(firstLocatedComplaint.longitude)]
      : [12.994, 75.333]
  const activeCenter = selectedMapCenter || mapCenter
  const mapMarkers = locatedComplaints.map((complaint) => ({
    id: complaint.id,
    lat: Number(complaint.latitude),
    lng: Number(complaint.longitude),
    popup: `${complaint.category === 'water_leakage' ? 'Reported water leakage · ' : ''}${complaint.title} (${complaint.category.replace(/_/g, ' ')})`,
    onClick: () => selectMapLocation(Number(complaint.latitude), Number(complaint.longitude)),
  }))

  useEffect(() => {
    let active = true
    setSatelliteLayer({ loading: true, available: false })
    api.getGeeOverlay(activeCenter[0], activeCenter[1])
      .then((result) => {
        if (active) setSatelliteLayer({ loading: false, ...result })
      })
      .catch((err) => {
        if (active) setSatelliteLayer({
          loading: false,
          available: false,
          message: err.message || 'Could not reach the Earth Engine service. Check the backend connection and retry.',
        })
      })
    
  return () => { active = false }
  }, [activeCenter[0], activeCenter[1]])

  
  return (
    <div className={`admin-dashboard-shell${embedded ? ' is-embedded' : ''}`}><aside className="admin-dashboard-sidebar"><a className="admin-dashboard-brand" href="/admin"><svg viewBox="0 0 100 90" aria-hidden="true"><g transform="translate(17.5 0) scale(.65)"><path fill="white" d="M50 1C35 1 25 12 25 27c0 18 25 40 25 40s25-22 25-40C75 12 65 1 50 1z"/><circle cx="50" cy="26" r="10" fill="#163F65"/></g><g transform="translate(0 15)"><path fill="white" d="M8 68h84v4H8zm8-13h8v13h-8zm12-8h8v21h-8zm13 5h8v16h-8zm13-15h8v31h-8zm13 8h8v23h-8zm13 9h8v14h-8z"/></g></svg><b><span>Urban</span> <strong>Eye</strong></b><small>See It. Report It. Improve It.</small></a><nav>{[['Dashboard','#dashboard'],['Streetlight Verification','/admin'],['Verify Reports','#complaints'],['Pothole Analysis','#complaints'],['Earth Engine Map','#map'],['All Issues','#complaints'],['Assign Teams','#complaints'],['Analytics','#analytics'],['Notifications','#activity']].map(([name,href],index)=><a key={name} href={href} className={(!location.hash && index === 0) || location.hash === href ? 'is-active' : ''}><AdminNavGlyph index={index}/>{name}</a>)}<a href="/profile">Profile</a><a href="/profile">Settings</a></nav><div className="admin-city-footer"><svg viewBox="0 0 420 120" aria-hidden="true"><path d="M5 110h410M25 110V67h24v43m15 0V35h30v75m14 0V57h27v53m16 0V18h35v92m17 0V50h30v60m15 0V31h39v79m18 0V60h30v50m17 0V43h32v67m16 0V72h23v38" fill="none" stroke="currentColor" stroke-width="3"/></svg><p>Cleaner Cities<br/>Safer Communities<br/>A Better Tomorrow</p></div></aside><main className="admin-dashboard-main"><header className="admin-dashboard-topbar"><label><svg className="admin-dashboard-top-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search for issues, locations..." /></label><a href="#activity" aria-label="Recent report activity"><svg className="admin-dashboard-top-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></a><a href="/profile">{user?.name || 'Admin'} · Administrator</a></header><div className="container">
      <div className="admin-dashboard-welcome" id="dashboard"><small>URBAN EYE · ADMIN CONSOLE</small><h1>Welcome back, {user?.name || 'Admin'}!</h1><p>Together, let's build a cleaner, safer and better city.</p><a href="#complaints">View All Reports ?</a></div>
      

      {analytics && (
        <>
          <div className="grid-3" id="analytics" style={{ marginBottom: '1.5rem' }}>
            <div className="card stat-card">
              <div className="value">{analytics.total_complaints}</div>
              <div className="label">Total Complaints</div>
            </div>
            <div className="card stat-card">
              <div className="value">{analytics.by_status?.pending || 0}</div>
              <div className="label">Pending Verification</div>
            </div>
            <div className="card stat-card">
              <div className="value">{analytics.by_category?.water_leakage || 0}</div>
              <div className="label">Water Leakage</div>
            </div>
            <div className="card stat-card">
              <div className="value">{analytics.by_status?.resolved || 0}</div>
              <div className="label">Resolved</div>
            </div>
            <div className="card stat-card">
              <div className="value">{analytics.by_priority?.high || 0}</div>
              <div className="label">High Priority</div>
            </div>
            <div className="card stat-card"><div className="value">{analytics.by_category?.pothole || 0}</div><div className="label">Potholes Detected</div></div>
          </div>

          <div className="card admin-map-card" id="map" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ marginBottom: '1rem' }}>{latestWaterLeak ? 'Water Leakage Location · Earth Engine Map' : 'Complaint Map & Earth Engine Satellite Imagery'}</h2>
<div className="admin-map-layout">
              <div className="admin-map-main">
                <LocationSearch onSelect={(point) => selectMapLocation(point.lat, point.lng)} />
            <MapView
                  center={activeCenter}
                  zoom={latestWaterLeak ? 14 : 11}
                  maxZoom={satelliteLayer.available ? satelliteLayer.satellite_max_zoom : 19}
                  satelliteMaxZoom={satelliteLayer.available ? satelliteLayer.satellite_max_zoom : 14}
                  markers={mapMarkers}
                  hotspots={analytics.hotspots || []}
                  satelliteTileUrl={satelliteLayer.available ? satelliteLayer.tile_url : ''}
                  waterTileUrl={satelliteLayer.available ? satelliteLayer.water_tile_url : ''}
                  selectedLocation={activeCenter}
                  onMapClick={selectMapLocation}
                  height="450px"
            />
</div>
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }} role="status">
              {satelliteLayer.loading
                ? 'Loading Sentinel-2 imagery from Google Earth Engine...'
                : satelliteLayer.available
                  ? `Sentinel-2 surface reflectance (${satelliteLayer.start_date} to ${satelliteLayer.end_date}; ${satelliteLayer.native_resolution_m} m native RGB, max zoom ${satelliteLayer.satellite_max_zoom}). Cyan pixels are possible surface water from MNDWI > 0 at ${satelliteLayer.water_resolution_m} m resolution; this is not a confirmed flood alert.`
                  : `${satelliteLayer.message || 'Earth Engine imagery is unavailable.'} Complaint markers remain available on the standard map.`}
            </p>
            {satelliteLayer.available && (
              <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                <span style={{ display: 'inline-block', width: '0.7rem', height: '0.7rem', marginRight: '0.4rem', borderRadius: '50%', background: 'var(--color-secondary)', verticalAlign: 'middle' }} />
                Possible surface water (MNDWI). Cloud, shadow, wet soil, and image-date differences can affect results.
              </p>
            )}
          </div>

          <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
            <div className="card">
              <h3 style={{ marginBottom: '0.75rem' }}>By Category</h3>
              {Object.entries(analytics.by_category || {}).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
                  <span>{k.replace(/_/g, ' ')}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <div className="card" id="activity">             <h3 style={{ marginBottom: '0.75rem' }}>By Department</h3>
              {Object.entries(analytics.by_department || {}).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
                  <span>{k}</span>
                  <strong>{v}</strong>
    
              <h4 className="admin-recent-activity-heading">Recent report activity</h4>
              {recentEvents.length ? recentEvents.map((event) => <div className="admin-recent-event" key={event.id}><b>Report #{event.complaintId} · {event.title} · {event.status.replace(/_/g, ' ')}</b><small>{new Date(event.changed_at).toLocaleString()}{event.note ? ' · ' + event.note : ''}</small></div>) : <p className="admin-recent-empty">No status activity is available.</p>}
            </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="card" id="complaints" style={{ marginBottom: '1rem', scrollMarginTop: '6rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="rejected">Rejected (existing records)</option>
          </select>
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All Categories</option>
            <option value="pothole">Pothole</option>
            <option value="garbage">Garbage</option>
            <option value="water_leakage">Water Leakage</option>
            <option value="streetlight">Streetlight</option>
            <option value="damaged_road">Damaged Road</option>
            <option value="drainage">Drainage</option>
            <option value="traffic_signal">Traffic Signal</option>
          </select>
          <button className="btn btn-outline" onClick={() => loadData(true)}>Refresh</button>
        </div>
      </div>

      {loadError && <p className="error-msg" role="status">{loadError} Retrying automatically.</p>}
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="complaint-list">
          {visibleComplaints.map((c) => (
            <ComplaintCard key={c.id} complaint={c} admin onUpdate={handleUpdate} onSelect={(item) => { setSelectedReportId(item.id); if (item.latitude != null && item.longitude != null) selectAnalysisLocation(Number(item.latitude), Number(item.longitude), item.title, item.id) }} />
          ))}
          {complaints.length === 0 && <div className="empty-state card">No complaints match the selected filters.</div>}
        </div>
      )}
    </div></main></div>  )
}







function AdminNavGlyph({ index }) {
  const paths = ['M3 10 12 3l9 7v10H3z', 'm5 12 4 4L19 6', 'M12 3c-3 4-6 7-6 11a6 6 0 0 0 12 0c0-4-3-7-6-11z', 'M4 7h16l-2 10H6z', 'M3 6 9 3l6 3 6-3v15l-6 3-6-3-6 3z', 'M5 4h14v16H5z', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 19V5m0 14h17M8 15l3-4 3 2 6-7', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9'];
  return <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index]}/></svg>
}

























