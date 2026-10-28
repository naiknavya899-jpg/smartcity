import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ComplaintCard from '../components/ComplaintCard'
import { api } from '../services/api'

export default function MyComplaints() {
  const location = useLocation()
  const targetComplaintId = location.hash.match(/^#complaint-(\d+)$/)?.[1] || ''
  const [complaints, setComplaints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestInFlight = useRef(false)

  const loadComplaints = useCallback(async () => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    try {
      setComplaints(await api.getMyComplaints())
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load your complaints.')
    } finally {
      requestInFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadComplaints()
    const intervalId = window.setInterval(loadComplaints, 4000)
    window.addEventListener('focus', loadComplaints)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', loadComplaints)
    }
  }, [loadComplaints])

  useEffect(() => {
    if (!targetComplaintId || loading) return undefined
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`complaint-${targetComplaintId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(scrollTimer)
  }, [targetComplaintId, loading, complaints.length])

  return (
    <div className="container">
      <div className="page-header">
        <h1>My Complaints</h1>
        <p>Track the status of your submitted issues</p>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <div>
          <p className="error-msg" role="status">{error}</p>
          <button className="btn btn-outline" onClick={loadComplaints}>Try again</button>
        </div>
      ) : complaints.length === 0 ? (
        <div className="empty-state card">
          <p>You haven't submitted any complaints yet.</p>
        </div>
      ) : (
        <div className="complaint-list">
          {complaints.map((c) => (
            <ComplaintCard key={c.id} complaint={c} initiallyOpen={String(c.id) === targetComplaintId} />
          ))}
        </div>
      )}
    </div>
  )
}
