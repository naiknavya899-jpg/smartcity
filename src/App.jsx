import { useCallback, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import SplashScreen from './components/SplashScreen'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import ReportIssue from './pages/ReportIssue'
import MyComplaints from './pages/MyComplaints'
import AdminStreetlightVerification from './pages/AdminStreetlightVerification'
import ProblemAnalysis from './pages/ProblemAnalysis'
import Profile from './pages/Profile'
import { useAuth } from './context/AuthContext'

export default function App() {
  const { user } = useAuth()
  const location = useLocation()
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return sessionStorage.getItem('urban-eye-splash-seen') !== 'true'
    } catch {
      return true
    }
  })
  const completeSplash = useCallback(() => {
    try {
      sessionStorage.setItem('urban-eye-splash-seen', 'true')
    } catch {
      // In-memory state still prevents the splash from reopening during this app session.
    }
    setShowSplash(false)
  }, [])

  return (
    <>
      {showSplash && <SplashScreen onComplete={completeSplash} />}
      {user && location.pathname !== '/' && !location.pathname.startsWith('/admin') && <Navbar />}
      <Routes>
        <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace /> : <Register />} />
        <Route path="/" element={
          <ProtectedRoute citizenOnly><Dashboard /></ProtectedRoute>
        } />
        <Route path="/report" element={
          <ProtectedRoute citizenOnly><ReportIssue /></ProtectedRoute>
        } />
        <Route path="/my-complaints" element={
          <ProtectedRoute citizenOnly><MyComplaints /></ProtectedRoute>
        } />
        <Route path="/analyze" element={
          <ProtectedRoute><ProblemAnalysis /></ProtectedRoute>
        } />
        <Route path="/admin" element={
          <ProtectedRoute adminOnly><AdminStreetlightVerification /></ProtectedRoute>
        } />
        <Route path="/admin/streetlights" element={<Navigate to="/admin" replace />} />
        <Route path="/profile" element={
          <ProtectedRoute><Profile /></ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  )
}





