import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await register(name, email, password, phoneNumber, smsEnabled)
      navigate('/')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '4rem' }}>
      <div className="card">
        <h1 style={{ marginBottom: '0.5rem' }}>Create Account</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Join the Smart City reporting platform
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </div>
          <div className="form-group">
            <label htmlFor="register-phone">Mobile number (optional)</label>
            <input
              id="register-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value)
                if (!e.target.value.trim()) setSmsEnabled(false)
              }}
              placeholder="10-digit Indian mobile number"
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
            <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} disabled={!phoneNumber.trim()} />
            Send me SMS updates when a complaint is registered or its status changes.
          </label>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
            Register
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.875rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
