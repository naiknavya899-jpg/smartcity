import { useEffect, useRef, useState } from 'react'

const GEOCODING_URL = 'https://photon.komoot.io/api/'

function featureLocation(feature) {
  const coordinates = feature?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const [lng, lat] = coordinates.map(Number)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

function featureLabel(feature) {
  const p = feature?.properties || {}
  return [...new Set([p.name, p.street, p.district, p.city, p.state, p.country].filter(Boolean))].join(', ') || 'Selected location'
}

export default function LocationSearch({ onSelect }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [active, setActive] = useState(0)
  const skipNext = useRef(false)

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return undefined }
    if (query.trim().length < 2) { setSuggestions([]); setMessage(''); setLoading(false); return undefined }
    const controller = new AbortController()
    let current = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setMessage('')
      try {
        const params = new URLSearchParams({ q: query.trim(), limit: '5', lang: 'en' })
        const response = await fetch(`${GEOCODING_URL}?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error('Place search is temporarily unavailable.')
        const data = await response.json()
        if (!current) return
        const results = (data.features || []).filter((feature) => featureLocation(feature))
        setSuggestions(results)
        setActive(0)
        setMessage(results.length ? '' : 'No matching places found. Try a more specific search.')
      } catch (error) {
        if (!current || error.name === 'AbortError') return
        setSuggestions([])
        setMessage(error.message || 'Could not search places. Check your connection.')
      } finally {
        if (current) setLoading(false)
      }
    }, 450)
    return () => { current = false; window.clearTimeout(timer); controller.abort() }
  }, [query])

  const choose = (feature) => {
    const point = featureLocation(feature)
    if (!point) return
    const label = featureLabel(feature)
    skipNext.current = true
    setQuery(label)
    setSuggestions([])
    setMessage('')
    onSelect(point, label)
  }

  const submit = async () => {
    if (!query.trim()) return
    setLoading(true)
    setMessage('')
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: '5', lang: 'en' })
      const response = await fetch(`${GEOCODING_URL}?${params}`)
      if (!response.ok) throw new Error('Place search is temporarily unavailable.')
      const data = await response.json()
      const result = (data.features || []).find((feature) => featureLocation(feature))
      if (!result) throw new Error('Location not found. Choose a suggestion or try a more specific place.')
      choose(result)
    } catch (error) {
      setMessage(error.message || 'Could not search places. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="location-search-wrap" style={{ marginBottom: '0.8rem' }}>
    <label htmlFor="analysis-location-search" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>Search location for analysis</label>
    <div className="location-search-row">
      <input id="analysis-location-search" type="search" value={query} autoComplete="off" placeholder="City, address, landmark, or place" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setActive((i) => (i + 1) % suggestions.length) }
        else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setActive((i) => (i - 1 + suggestions.length) % suggestions.length) }
        else if (event.key === 'Escape') setSuggestions([])
        else if (event.key === 'Enter') { event.preventDefault(); if (suggestions.length) choose(suggestions[active] || suggestions[0]); else submit() }
      }} />
      <button type="button" className="btn btn-outline location-search-button" onClick={submit} disabled={loading || !query.trim()}>{loading ? 'Searching…' : 'Find location'}</button>
    </div>
    {(loading || suggestions.length > 0 || message) && <div className="location-suggestions" role="listbox" aria-label="Location suggestions">
      {loading && <div className="location-search-status" role="status">Searching places…</div>}
      {suggestions.map((feature, index) => <button type="button" role="option" aria-selected={index === active} key={`${feature.properties?.osm_id || ''}-${index}`} className={`location-suggestion${index === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(feature)}><span className="location-suggestion-name">{featureLabel(feature)}</span><span className="location-suggestion-type">{feature.properties?.type || feature.properties?.osm_value || 'Place'}</span></button>)}
      {!loading && message && <div className="location-search-status" role="status">{message}</div>}
    </div>}
  </div>
}
