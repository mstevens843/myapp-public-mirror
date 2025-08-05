// src/utils/authFetch.js
export async function authFetch(path, options = {}) {
  const token =
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("accessToken");

  const merged = {
    credentials: "include",                 // cookie support
    headers: {
      ...(options.method && options.method !== "GET"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  };

  return fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, merged);
}