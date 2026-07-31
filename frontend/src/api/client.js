const API_BASE = '/api';

/**
 * Wrapper de fetch para la API del backend.
 * Agrega automáticamente el token JWT si existe en localStorage.
 */
async function apiClient(endpoint, options = {}) {
  const token = localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
    const err = new Error(error.error || `Error ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

export const api = {
  get: (endpoint) => apiClient(endpoint),
  post: (endpoint, data) => apiClient(endpoint, { method: 'POST', body: JSON.stringify(data) }),
  put: (endpoint, data) => apiClient(endpoint, { method: 'PUT', body: JSON.stringify(data) }),
  patch: (endpoint, data) => apiClient(endpoint, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (endpoint) => apiClient(endpoint, { method: 'DELETE' }),
};
