import io from "socket.io-client";

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);

let socket = null;

export const connectSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;
