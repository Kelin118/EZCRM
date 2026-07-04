import axios from 'axios';

import { ACCESS_TOKEN_KEY, clearStoredAuth, REFRESH_TOKEN_KEY } from '../auth.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api/';

const api = axios.create({
  baseURL: API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`,
});

function clearAuthAndRedirect() {
  clearStoredAuth();
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);

    if (error.response?.status === 401 && refresh && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const { data } = await axios.post(`${api.defaults.baseURL}token/refresh/`, { refresh });
        localStorage.setItem(ACCESS_TOKEN_KEY, data.access);
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch {
        clearAuthAndRedirect();
      }
    }

    if (error.response?.status === 403) {
      window.dispatchEvent(new CustomEvent('api-forbidden', { detail: 'Нет доступа к этому действию' }));
    }

    if (error.response?.status === 401) {
      clearAuthAndRedirect();
    }

    return Promise.reject(error);
  },
);

export default api;
