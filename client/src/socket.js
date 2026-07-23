import { io } from "socket.io-client";
import { API_URL } from "./api";

let socket = null;

export function getSocket() {
  if (socket) return socket;
  const token = localStorage.getItem("token");
  socket = io(API_URL, {
    auth: { token },
    autoConnect: false,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
