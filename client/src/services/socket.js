import { io } from 'socket.io-client';

export function createSocket() {
  const endpoint = import.meta.env.VITE_SOCKET_URL || window.location.origin;
  return io(endpoint, { path: '/socket.io', autoConnect: false, withCredentials: true, reconnectionAttempts: 5, transports: ['websocket', 'polling'] });
}
