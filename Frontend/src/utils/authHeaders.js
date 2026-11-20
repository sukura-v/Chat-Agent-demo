/** Authentication headers shared by the Axios and fetch clients. */
export function getIdentityHeaders() {
  const user = JSON.parse(localStorage.getItem('oral_rehab_user') || 'null')
  const token = localStorage.getItem('oral_rehab_token')
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (user?.patient_id) headers['X-Patient-ID'] = String(user.patient_id)
  if (user?.doctor_id) headers['X-Doctor-ID'] = String(user.doctor_id)
  if (user?.user_role) headers['X-User-Role'] = user.user_role
  return headers
}

export function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  try {
    Object.assign(headers, getIdentityHeaders())
  } catch (_) { /* Preserve fetch clients' handling of unavailable or corrupt storage. */ }
  return headers
}
