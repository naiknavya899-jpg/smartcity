import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import { useEffect, useRef } from 'react'
import L from 'leaflet'

const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = defaultIcon

export default function MapView({
  center = [19.076, 72.8777],
  zoom = 13,
  maxZoom = 19,
  satelliteMaxZoom = 14,
  markers = [],
  hotspots = [],
  satelliteTileUrl = '',
  waterTileUrl = '',
  selectedLocation = null,
  onMapClick,
  height = '400px',
}) {
  return (
    <div className="map-container" style={{ height }}>
      <MapContainer center={center} zoom={zoom} maxZoom={maxZoom} style={{ height: '100%', width: '100%' }}>
        <MapCenterUpdater center={center} zoom={zoom} maxZoom={maxZoom} />
        <MapResizeObserver />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={maxZoom}
        />
        {satelliteTileUrl && (
          <TileLayer
            attribution='Imagery &copy; <a href="https://earthengine.google.com/">Google Earth Engine</a> / Copernicus Sentinel-2'
            url={satelliteTileUrl}
            opacity={1}
            maxNativeZoom={satelliteMaxZoom}
            maxZoom={satelliteMaxZoom}
          />
        )}
        {waterTileUrl && (
          <TileLayer
            attribution='Surface water estimate &copy; Google Earth Engine / Copernicus Sentinel-2'
            url={waterTileUrl}
            opacity={0.85}
            maxNativeZoom={13}
            maxZoom={satelliteMaxZoom}
          />
        )}
        {selectedLocation && <Marker position={selectedLocation}><Popup>Selected location</Popup></Marker>}
        {markers.map((m) => m.statusColor ? (
          <CircleMarker
            key={m.id || `${m.lat}-${m.lng}`}
            center={[m.lat, m.lng]}
            radius={8}
            pathOptions={{ color: 'var(--color-background)', weight: 2, fillColor: m.statusColor, fillOpacity: 0.95 }}
          >
            {m.popup && <Popup>{m.popup}</Popup>}
          </CircleMarker>
        ) : (
          <Marker
            key={m.id || `${m.lat}-${m.lng}`}
            position={[m.lat, m.lng]}
            draggable={Boolean(m.draggable)}
            eventHandlers={(m.onDrag || m.onClick) ? {
              click() { m.onClick?.() },
              dragend(event) {
                const point = event.target.getLatLng()
                m.onDrag(point.lat, point.lng)
              },
            } : undefined}
          >
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}
        {hotspots.map((h, i) => (
          <CircleMarker
            key={`hotspot-${i}`}
            center={[h.latitude, h.longitude]}
            radius={Math.min(h.count * 5, 30)}
            pathOptions={{ color: 'var(--color-error)', fillColor: 'var(--color-error)', fillOpacity: 0.4 }}
          >
            <Popup>
              <strong>Hotspot</strong><br />
              {h.count} issues — {h.dominant_category?.replace(/_/g, ' ')}
            </Popup>
          </CircleMarker>
        ))}
        {onMapClick && <MapClickHandler onClick={onMapClick} />}
      </MapContainer>
    </div>
  )
}

function MapResizeObserver() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const observedElement = container.parentElement || container
    let frameId = 0
    const refreshSize = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => map.invalidateSize({ animate: false, pan: false }))
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refreshSize)
    observer?.observe(observedElement)
    window.addEventListener('resize', refreshSize)
    refreshSize()

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', refreshSize)
      window.cancelAnimationFrame(frameId)
    }
  }, [map])

  return null
}

function MapCenterUpdater({ center, zoom, maxZoom }) {
  const map = useMap()
  const previousView = useRef('')
  useEffect(() => {
    map.setMaxZoom(maxZoom)
    const nextView = `${center[0]}:${center[1]}:${zoom}:${maxZoom}`
    if (previousView.current !== nextView) {
      map.setView(center, Math.min(zoom, maxZoom))
      previousView.current = nextView
    }
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom)
  }, [map, center, zoom, maxZoom])
  return null
}

function MapClickHandler({ onClick }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}







