import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      api.getMe()
        .then(setUser)
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email, password) => {
    const data = await api.login({ email, password })
    localStorage.setItem('token', data.access_token)
    setUser(data.user)
    return data.user
  }

  const register = async (name, email, password, phoneNumber, smsEnabled) => {
    const data = await api.register({
      name,
      email,
      password,
      phone_number: phoneNumber || null,
      sms_notifications_enabled: Boolean(smsEnabled),
    })
    localStorage.setItem('token', data.access_token)
    setUser(data.user)
    return data.user
  }

  const updateProfile = async (profile) => {
    const updatedUser = await api.updateProfile(profile)
    setUser(updatedUser)
    return updatedUser
  }

  const updateProfilePicture = async (file) => {
    const updatedUser = await api.updateProfilePicture(file)
    setUser(updatedUser)
    return updatedUser
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, updateProfile, updateProfilePicture, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
