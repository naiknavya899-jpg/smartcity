const API_BASE = ''

function getToken() {
  return localStorage.getItem('token')
}

async function request(path, options = {}) {
  const headers = { ...options.headers }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data.detail
    const message = typeof detail === 'string' ? detail : detail?.message || data.message || 'Request failed'
    throw new Error(message)
  }
  return data
}

export const api = {
  register: (body) => request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  login: (body) => request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  getMe: () => request('/api/auth/me'),
  updateProfile: (body) => request('/api/auth/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  updateProfilePicture: (file) => {
    const body = new FormData()
    body.append('file', file, file.name || 'profile-picture.jpg')
    return request('/api/auth/me/profile-picture', { method: 'POST', body })
  },
  createComplaint: (formData) => request('/api/complaints', { method: 'POST', body: formData }),
  getMyComplaints: () => request('/api/complaints/mine'),
  getComplaint: (id) => request(`/api/complaints/${id}`),
  getAdminComplaints: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/admin/complaints${qs ? `?${qs}` : ''}`)
  },
  updateComplaint: (id, body) => request(`/api/admin/complaints/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  getAnalytics: () => request('/api/admin/analytics'),
  getGeeOverlay: (lat, lon) => request(`/api/admin/gee/overlay?${new URLSearchParams({ lat, lon })}`),
  analyzeProblemInput: (inputText) => request('/api/problem-analysis/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_text: inputText }),
  }),
  sendChatbotMessage: (message, history = []) => request('/api/chatbot/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  }),
}
