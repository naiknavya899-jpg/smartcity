import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const user = await login(email, password)
      navigate(user.role === 'admin' ? '/admin' : '/')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: '4rem' }}>
      <div className="card">
        <h1 style={{ marginBottom: '0.5rem' }}>Sign In</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Report civic issues and track their resolution
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
            Login
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.875rem' }}>
          No account? <Link to="/register">Register</Link>
        </p>
        <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>
          Admin demo: admin@smartcity.gov / admin123
        </p>
      </div>
    </div>
  )
}
