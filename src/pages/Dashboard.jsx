import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import StatusBadge from '../components/StatusBadge'
import MapView from '../components/MapView'
import AssistantChatbot from '../components/AssistantChatbot'

const STATUS_COLORS = {
  pending: 'var(--color-warning)',
  in_progress: 'var(--color-secondary)',
  resolved: 'var(--color-success)',
  rejected: 'var(--color-error)',
}

function Icon({ name, size = 20 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const shapes = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    report: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
    issues: <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.8-1.8 3.1-2.1-.5a8 8 0 0 1-1.7 1l-.5 2.1h-3.6l-.5-2.1a8 8 0 0 1-1.7-1l-2.1.5-1.8-3.1L6 15a8 8 0 0 1 0-2l-1.2-1.8 1.8-3.1 2.1.5a8 8 0 0 1 1.7-1l.5-2.1h3.6l.5 2.1a8 8 0 0 1 1.7 1l2.1-.5 1.8 3.1L19.4 13a8 8 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.7 9a7 7 0 0 1 11.5-2L20 12M4 12l2.5 5a7 7 0 0 0 11.8-2" /></>,
    sprout: <><path d="M12 21v-9" /><path d="M12 12C6 12 4 9 4 5c5 0 8 2 8 7ZM12 15c0-5 3-8 8-8 0 5-2 8-8 8Z" /></>,
    community: <><circle cx="12" cy="8" r="2.5" /><circle cx="5" cy="10" r="2" /><circle cx="19" cy="10" r="2" /><path d="M7 20a5 5 0 0 1 10 0M1.5 19a3.5 3.5 0 0 1 5-3.2M22.5 19a3.5 3.5 0 0 0-5-3.2" /></>,
    sparkle: <><path d="m12 3 1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{shapes[name] || shapes.sparkle}</svg>
}

function CitySkyline({ className }) {
  return (
    <svg className={className} viewBox="0 0 420 190" fill="none" aria-hidden="true" focusable="false">
      <path className="skyline-layer skyline-far" d="M0 184v-45h25v-32h22v77h17v-58h28v58h16V96h29v88h17V55h31v129h18v-61h27v61h17V89h32v95h18v-48h24v48h18V67h31v117h17v-48h25v48h17v6H0Z" />
      <path className="skyline-layer skyline-near" d="M0 184v-22h19v-18h20v40h15v-34h27v34h15v-52h26v52h16v-29h27v29h17v-43h28v43h17v-27h24v27h16v-49h30v49h15v-34h26v34h16v-22h26v22h17v6H0Z" />
      <g className="skyline-windows">
        <path d="M119 108h5v7h-5zm11 0h5v7h-5zm-11 14h5v7h-5zm11 0h5v7h-5zm42-44h5v8h-5zm13 0h5v8h-5zm-13 16h5v8h-5zm13 0h5v8h-5zm73 12h5v7h-5zm12 0h5v7h-5zm-12 14h5v7h-5zm12 0h5v7h-5zm70-12h5v7h-5zm12 0h5v7h-5zm-12 14h5v7h-5zm12 0h5v7h-5z" />
      </g>
      <g className="skyline-trees">
        <path d="M8 184c-8-10-2-20 6-18-3-10 9-14 13-4 9-2 12 8 5 13 8 0 9 6 4 9Zm367 0c-7-9-2-17 6-16-2-9 9-13 12-4 8-1 11 7 5 12 7 0 8 5 4 8Z" />
      </g>
    </svg>
  )
}

function UrbanEyeLogoMark() {
  return (
    <svg className="dashboard-brand-symbol" viewBox="0 0 587 453" aria-hidden="true" focusable="false">
      <defs>
        <filter id="urban-eye-sidebar-mark" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 1.2 0 -0.11" />
        </filter>
      </defs>
      <image href="/images/urban-eye-logo-mark.png" x="0" y="0" width="587" height="453" filter="url(#urban-eye-sidebar-mark)" preserveAspectRatio="xMidYMid meet" />
    </svg>
  )
}

function CityReportingIllustration() {
  return (
    <svg className="dashboard-sidebar-city-art" viewBox="0 0 230 100" fill="none" aria-hidden="true" focusable="false">
      <g className="city-report-line">
        <path d="M8 87h214" />
        <path d="M14 87V61h16v26M19 61V49h6v12M34 87V72h15v15M39 72V62h6v10M52 87V48h18v39M57 48V35h8v13M76 87V65h18v22M81 65V53h8v12M99 87V57h17v30M104 57V46h7v11" />
        <path d="M38 31c-7 0-12 5-12 12 0 9 12 21 12 21s12-12 12-21c0-7-5-12-12-12Z" />
        <circle cx="38" cy="43" r="4" />
        <rect x="151" y="33" width="33" height="48" rx="3" />
        <path d="M158 43h18M158 50h18M158 57h11M158 66l4 4 8-9" />
        <path d="M123 87V67h15v20M127 67V56h7v11M189 87V60h15v27M193 60V50h7v10" />
      </g>
      <path className="city-report-accent" d="M134 82h30" />
    </svg>
  )
}

function getInitials(name) {
  return (name || 'Urban Eye').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatStatus(status) {
  return (status || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, options).format(date)
}

function hasValidLocation(issue) {
  return issue.latitude != null && issue.longitude != null
    && Number.isFinite(Number(issue.latitude)) && Number.isFinite(Number(issue.longitude))
    && Number(issue.latitude) >= -90 && Number(issue.latitude) <= 90
    && Number(issue.longitude) >= -180 && Number(issue.longitude) <= 180
}

export default function Dashboard() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [fullMapOpen, setFullMapOpen] = useState(false)
  const requestInFlight = useRef(false)

  const loadIssues = useCallback(async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    try {
      const records = await api.getMyComplaints()
      setIssues(Array.isArray(records) ? records : [])
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Could not load your issue reports.')
    } finally {
      requestInFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadIssues()
    const refreshTimer = window.setInterval(loadIssues, 30000)
    window.addEventListener('focus', loadIssues)
    return () => {
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', loadIssues)
    }
  }, [loadIssues])

  useEffect(() => {
    const target = location.hash.slice(1)
    if (target !== 'city-map' && target !== 'notifications') return undefined
    const scrollTimer = window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => window.clearTimeout(scrollTimer)
  }, [location.hash])

  const recentFirst = useMemo(() => [...issues].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [issues])
  const dataUnavailable = Boolean(error && issues.length === 0)
  const total = issues.length
  const pending = issues.filter((issue) => issue.status === 'pending').length
  const inProgress = issues.filter((issue) => issue.status === 'in_progress').length
  const resolved = issues.filter((issue) => issue.status === 'resolved').length
  const resolutionRate = total ? Math.round((resolved / total) * 100) : 0
  const recentIssues = recentFirst.slice(0, 5)
  const locatedIssues = useMemo(() => recentFirst.filter(hasValidLocation), [recentFirst])
  const mapCenter = locatedIssues.length
    ? [locatedIssues.reduce((sum, issue) => sum + Number(issue.latitude), 0) / locatedIssues.length,
      locatedIssues.reduce((sum, issue) => sum + Number(issue.longitude), 0) / locatedIssues.length]
    : null
  const mapMarkers = locatedIssues.map((issue) => ({
    id: `issue-${issue.id}`,
    lat: Number(issue.latitude),
    lng: Number(issue.longitude),
    statusColor: STATUS_COLORS[issue.status] || 'var(--color-text-secondary)',
    popup: `${issue.title} | ${formatStatus(issue.status)}${issue.address ? ` | ${issue.address}` : ''}`,
  }))
  const updates = useMemo(() => issues.flatMap((issue) => (issue.status_history || []).map((event) => ({
    id: `${issue.id}-${event.id}`,
    issueId: issue.id,
    issueTitle: issue.title,
    status: event.status,
    changedAt: event.changed_at,
  }))).sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt)).slice(0, 5), [issues])
  const matchingIssues = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return []
    return recentFirst.filter((issue) => [issue.title, issue.description, issue.category, issue.address,
      hasValidLocation(issue) ? `${issue.latitude} ${issue.longitude}` : ''].join(' ').toLocaleLowerCase().includes(normalized)).slice(0, 6)
  }, [query, recentFirst])
  const firstName = user?.name?.trim().split(/\s+/)[0] || 'there'
  const navLinkClass = ({ isActive }) => `dashboard-nav-item${isActive ? ' is-active' : ''}`
  const closeMobileNav = () => setMobileNavOpen(false)
  const signOut = () => {
    logout()
    navigate('/login')
  }
  const openIssue = (issueId) => {
    setQuery('')
    navigate(`/my-complaints#complaint-${issueId}`)
  }

  const stats = [
    { label: 'Total Reported', value: total, icon: 'issues', tone: 'sky' },
    { label: 'Pending', value: pending, icon: 'clock', tone: 'amber' },
    { label: 'In Progress', value: inProgress, icon: 'refresh', tone: 'blue' },
    { label: 'Resolved', value: resolved, icon: 'check', tone: 'green' },
  ]

  return (
    <div className="dashboard-shell">
      {mobileNavOpen && <button className="dashboard-sidebar-backdrop" aria-label="Close navigation menu" onClick={closeMobileNav} />}
      <aside className={`dashboard-sidebar${mobileNavOpen ? ' is-open' : ''}`}>
        <Link to="/" className="dashboard-brand" onClick={closeMobileNav}>
          <UrbanEyeLogoMark />
          <span className="dashboard-brand-copy">
            <strong className="dashboard-brand-name"><span className="dashboard-brand-urban">Urban</span><span className="dashboard-brand-eye">Eye</span></strong>
            <small>See It. Report It. Improve It.</small>
          </span>
        </Link>
        <nav className="dashboard-side-nav" aria-label="Main navigation">
          <NavLink to="/" end className={navLinkClass} onClick={closeMobileNav}><Icon name="dashboard" />Dashboard</NavLink>
          <NavLink to="/report" className={navLinkClass} onClick={closeMobileNav}><Icon name="report" />Report an Issue</NavLink>
          <NavLink to="/my-complaints" className={navLinkClass} onClick={closeMobileNav}><Icon name="issues" />My Issues</NavLink>
          <Link to="/#city-map" className={`dashboard-nav-item${location.hash === '#city-map' ? ' is-active' : ''}`} onClick={closeMobileNav}><Icon name="map" />City Map</Link>
          <Link to="/#notifications" className={`dashboard-nav-item${location.hash === '#notifications' ? ' is-active' : ''}`} onClick={closeMobileNav}><Icon name="bell" />Notifications</Link>
          <NavLink to="/profile" end className={({ isActive }) => `dashboard-nav-item${isActive && location.hash !== '#settings' ? ' is-active' : ''}`} onClick={closeMobileNav}><Icon name="user" />Profile</NavLink>
          <NavLink to="/profile#settings" className={({ isActive }) => `dashboard-nav-item${isActive && location.hash === '#settings' ? ' is-active' : ''}`} onClick={closeMobileNav}><Icon name="settings" />Settings</NavLink>
        </nav>
        <div className="dashboard-sidebar-footer">
          <CityReportingIllustration />
          <span>Cleaner Cities</span>
          <span>Safer Communities</span>
          <strong>A Better Tomorrow</strong>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <button className="dashboard-menu-toggle" onClick={() => setMobileNavOpen((open) => !open)} aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen}>
            <Icon name={mobileNavOpen ? 'close' : 'menu'} />
          </button>
          <div className="dashboard-search-wrap">
            <Icon name="search" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for issues, locations..." aria-label="Search your issues and locations" />
            {query.trim() && <div className="dashboard-search-results" role="listbox" aria-label="Matching issues">
              {loading || dataUnavailable ? <p>{loading ? 'Loading your issues...' : 'Issue search is unavailable until your reports load.'}</p> : matchingIssues.length ? matchingIssues.map((issue) => <button key={issue.id} type="button" role="option" onClick={() => openIssue(issue.id)}>
                <strong>{issue.title}</strong><span>{issue.address || issue.category.replace(/_/g, ' ')} | {formatDate(issue.created_at)}</span>
              </button>) : <p>{loading ? 'Loading your issues...' : 'No matching issues found.'}</p>}
            </div>}
          </div>
          <div className="dashboard-topbar-actions">
            <Link to="/#notifications" className="dashboard-icon-button" aria-label="View issue updates"><Icon name="bell" /></Link>
            <details className="dashboard-profile-menu">
              <summary>
                <span className="dashboard-avatar">{user?.profile_image_path
                  ? <img src={`/uploads/${encodeURIComponent(user.profile_image_path)}`} alt="" />
                  : getInitials(user?.name)}</span>
                <span className="dashboard-profile-copy"><small>Hi, {firstName}</small><strong>{user?.name || 'Urban Eye user'}</strong></span>
                <span className="dashboard-profile-chevron">?</span>
              </summary>
              <div className="dashboard-profile-dropdown">
                <Link to="/profile">My Profile</Link>
                <Link to="/profile#settings">Settings</Link>
                <button type="button" onClick={signOut}>Sign out</button>
              </div>
            </details>
          </div>
        </header>

        <div className={`dashboard-content${error ? ' has-load-error' : ''}`}>
          {error && <div className="dashboard-load-error" role="alert"><span>{error}</span><button className="btn btn-outline" onClick={loadIssues}>Try again</button></div>}

          <section className="dashboard-welcome" aria-labelledby="dashboard-welcome-title">
            <div className="dashboard-welcome-copy">
              <span className="dashboard-eyebrow">YOUR COMMUNITY, YOUR IMPACT</span>
              <h1 id="dashboard-welcome-title">Welcome back, {user?.name || 'Urban Eye user'}!</h1>
              <p className="dashboard-welcome-tagline">See it. Report it. Improve it.</p>
              <p className="dashboard-welcome-description">Together, let's build a cleaner, safer and better city.</p>
              <Link to="/report" className="btn dashboard-welcome-button">Report an Issue <Icon name="arrow" size={18} /></Link>
            </div>
            <CitySkyline className="dashboard-welcome-skyline" />
          </section>

          <section className="dashboard-stat-grid" aria-label="Your issue statistics">
            {stats.map((stat, index) => <article className={`dashboard-stat-card tone-${stat.tone}`} key={stat.label} style={{ '--stagger': `${index * 70}ms` }}>
              <span className="dashboard-stat-icon"><Icon name={stat.icon} /></span>
              <span className="dashboard-stat-label">{stat.label}</span>
              <strong className="dashboard-stat-value">{loading || dataUnavailable ? '?' : stat.value}</strong>
              <span className="dashboard-stat-arrow"><Icon name="arrow" size={18} /></span>
            </article>)}
          </section>

          <div className="dashboard-primary-grid">
            <section className="dashboard-panel recent-panel" aria-labelledby="recent-issues-title">
              <div className="dashboard-panel-heading">
                <div><h2 id="recent-issues-title">Recent Issues</h2><p>Your latest community reports</p></div>
                <Link to="/my-complaints" className="dashboard-text-link">View All <Icon name="arrow" size={16} /></Link>
              </div>
              {loading ? <div className="dashboard-empty"><span className="dashboard-spinner" />Loading your issues...</div> : dataUnavailable ? <div className="dashboard-empty"><strong>Issue data unavailable</strong><span>Your reports could not be loaded. Try again shortly.</span><button type="button" className="dashboard-text-link" onClick={loadIssues}>Try again</button></div> : recentIssues.length ? <div className="dashboard-issue-list">
                {recentIssues.map((issue) => <article className="dashboard-issue-row" key={issue.id}>
                  {issue.image_path ? <img className="dashboard-issue-image" src={`/uploads/${issue.image_path}`} alt={issue.title} loading="lazy" /> : <div className="dashboard-issue-placeholder"><Icon name="camera" /></div>}
                  <div className="dashboard-issue-main">
                    <div className="dashboard-issue-title-row"><h3>{issue.title}</h3><StatusBadge status={issue.status} /></div>
                    <span className="dashboard-issue-category">{issue.category.replace(/_/g, ' ')}</span>
                    <span className="dashboard-issue-location"><Icon name="pin" size={14} />{issue.address || (hasValidLocation(issue) ? `${Number(issue.latitude).toFixed(4)}, ${Number(issue.longitude).toFixed(4)}` : 'Location unavailable')}</span>
                    <span className="dashboard-issue-date"><Icon name="clock" size={14} />Reported {formatDate(issue.created_at)}</span>
                  </div>
                  <Link className="dashboard-view-issue" to={`/my-complaints#complaint-${issue.id}`}>View Details</Link>
                </article>)}
              </div> : <div className="dashboard-empty"><span className="dashboard-empty-icon"><Icon name="issues" size={24} /></span><strong>No issues reported yet</strong><span>Your submitted reports will appear here.</span><Link to="/report" className="dashboard-text-link">Report your first issue <Icon name="arrow" size={16} /></Link></div>}
            </section>

            <section className="dashboard-panel map-panel" id="city-map" aria-labelledby="city-map-title">
              <div className="dashboard-panel-heading">
                <div className="dashboard-heading-with-icon"><span className="dashboard-heading-icon"><Icon name="map" size={19} /></span><div><h2 id="city-map-title">City Map</h2><p>Locations from your issue reports</p></div></div>
                <button type="button" className="dashboard-text-link" onClick={() => setFullMapOpen(true)} disabled={!locatedIssues.length}>View Full Map <Icon name="arrow" size={16} /></button>
              </div>
              {locatedIssues.length && mapCenter ? <>
                <div className="dashboard-map-wrap"><MapView center={mapCenter} zoom={12} maxZoom={18} height="300px" markers={mapMarkers} /></div>
                <div className="dashboard-map-legend">
                  <span><i className="tone-pending" />Pending</span><span><i className="tone-progress" />In Progress</span><span><i className="tone-resolved" />Resolved</span><span><i className="tone-rejected" />Rejected</span>
                </div>
              </> : <div className="dashboard-map-empty"><Icon name="map" size={30} /><strong>{dataUnavailable ? 'Issue locations unavailable' : 'No mapped issues yet'}</strong><span>{dataUnavailable ? 'Your reports could not be loaded.' : 'Reports with valid coordinates will appear here.'}</span></div>}
            </section>
          </div>

          <div className="dashboard-secondary-grid">
            <section className="dashboard-panel impact-panel" aria-labelledby="impact-title">
              <div className="dashboard-panel-heading"><div><h2 id="impact-title">My Impact</h2><p>Your contribution to the community</p></div><span className="dashboard-impact-icon"><Icon name="sprout" /></span></div>
              <div className="dashboard-impact-content">
                <div className="dashboard-progress-ring" style={{ '--impact-progress': `${resolutionRate * 3.6}deg` }} aria-label={dataUnavailable ? 'Resolution rate unavailable' : `Resolution rate ${resolutionRate}%`} role="img"><span>{loading || dataUnavailable ? '?' : `${resolutionRate}%`}</span></div>
                <div className="dashboard-impact-stats">
                  <div><span>Issues Reported</span><strong>{loading || dataUnavailable ? '?' : total}</strong></div>
                  <div><span>Issues Resolved</span><strong>{loading || dataUnavailable ? '?' : resolved}</strong></div>
                  <div><span>Resolution Rate</span><strong>{loading || dataUnavailable ? '?' : `${resolutionRate}%`}</strong></div>
                </div>
              </div>
              {!loading && total === 0 && <p className="dashboard-impact-note">Your impact summary will update when you report an issue.</p>}
            </section>

            <section className="dashboard-panel notifications-panel" id="notifications" aria-labelledby="notifications-title">
              <div className="dashboard-panel-heading"><div><h2 id="notifications-title">Latest Updates</h2><p>Recent status history for your issues</p></div><span className="dashboard-notification-icon"><Icon name="bell" /></span></div>
              {dataUnavailable ? <div className="dashboard-empty dashboard-updates-empty"><strong>Updates unavailable</strong><span>Your report history could not be loaded.</span></div> : updates.length ? <div className="dashboard-update-list">{updates.map((update) => <Link className="dashboard-update-row" key={update.id} to={`/my-complaints#complaint-${update.issueId}`}>
                <span className="dashboard-update-dot" style={{ background: STATUS_COLORS[update.status] || 'var(--color-text-secondary)' }} />
                <span className="dashboard-update-copy"><strong>{update.status === 'resolved' ? 'Issue marked resolved' : 'Issue status updated'}</strong><span>{update.issueTitle} ? {formatStatus(update.status)}</span></span>
                <time>{formatDate(update.changedAt, { month: 'short', day: 'numeric' })}</time>
              </Link>)}</div> : <div className="dashboard-empty dashboard-updates-empty"><span className="dashboard-empty-icon"><Icon name="bell" size={24} /></span><strong>No issue updates yet</strong><span>Status updates will appear here when your reports change.</span></div>}
              <Link to="/my-complaints" className="dashboard-text-link dashboard-updates-link">View all issue history <Icon name="arrow" size={16} /></Link>
            </section>
          </div>

          <section className="dashboard-bottom-cta">
            <span className="dashboard-cta-icon"><Icon name="community" size={25} /></span>
            <div><h2>Be the change your city needs</h2><p>Your voice matters. Report issues, help your community, build a better tomorrow.</p></div>
            <Link to="/report" className="btn dashboard-cta-button">Report an Issue <Icon name="arrow" size={18} /></Link>
          </section>
        </div>
      </main>

      {fullMapOpen && locatedIssues.length > 0 && mapCenter && <div className="dashboard-map-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFullMapOpen(false) }}>
        <section className="dashboard-map-dialog" role="dialog" aria-modal="true" aria-labelledby="full-map-title">
          <div className="dashboard-panel-heading"><div><h2 id="full-map-title">Your City Map</h2><p>Showing {locatedIssues.length} issue location{locatedIssues.length === 1 ? '' : 's'} with valid coordinates</p></div><button className="dashboard-icon-button" aria-label="Close map" onClick={() => setFullMapOpen(false)}><Icon name="close" /></button></div>
          <MapView center={mapCenter} zoom={12} maxZoom={18} height="min(70vh, 680px)" markers={mapMarkers} />
        </section>
      </div>}
      {user?.role === 'citizen' && <AssistantChatbot key={user.id} />}
    </div>
  )
}
