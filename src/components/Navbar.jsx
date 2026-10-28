import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const homePath = user?.role === 'admin' ? '/admin' : '/'
  const navClass = (isActive) => `app-nav-link${isActive ? ' is-active' : ''}`

  return (
    <nav className="app-navbar">
      <div className="container app-navbar-inner">
        <Link to={homePath} className="app-navbar-brand">
          Smart City Reporting
        </Link>
        {user && (
          <div className="app-navbar-links">
            {user.role === 'admin' ? (
              <>
                <NavLink to="/admin#dashboard" className={({ isActive }) => navClass(isActive && location.hash === '#dashboard')}>Admin Dashboard</NavLink>
                <Link to="/admin#complaints" className={navClass(location.hash === '#complaints')}>Manage Complaints</Link>
                <Link to="/admin#analytics" className={navClass(location.hash === '#analytics')}>Analytics</Link>
                <NavLink to="/analyze" className={({ isActive }) => navClass(isActive)}>Analyze Text</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>Home</NavLink>
                <NavLink to="/report" className={({ isActive }) => navClass(isActive)}>Report Issue</NavLink>
                <NavLink to="/my-complaints" className={({ isActive }) => navClass(isActive)}>My Complaints</NavLink>
                <NavLink to="/analyze" className={({ isActive }) => navClass(isActive)}>Analyze Text</NavLink>
              </>
            )}
            <NavLink to="/profile" className={({ isActive }) => navClass(isActive)}>My Profile</NavLink>
            <span className="app-navbar-user">{user.name}</span>
            <button className="btn btn-outline app-navbar-logout" onClick={handleLogout}>Logout</button>
          </div>
        )}
      </div>
    </nav>
  )
}
