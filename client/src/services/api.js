import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

export function getMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error?.response?.status === 502) {
    const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return isLocal
      ? 'Cannot reach the local API. Make sure MongoDB is connected and the API is running on port 5000, then refresh.'
      : 'The server is temporarily unavailable. Please try again in a moment.';
  }
  return error?.response?.data?.message || error?.message || fallback;
}

export default api;
