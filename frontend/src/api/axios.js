import axios from 'axios';

import { ACCESS_TOKEN_KEY, clearStoredAuth, REFRESH_TOKEN_KEY } from '../auth.js';

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000/api/',
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
        const { data } = await axios.post('http://127.0.0.1:8000/api/token/refresh/', { refresh });
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
