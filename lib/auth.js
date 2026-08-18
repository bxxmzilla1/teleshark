// Simple password gate for the whole app.
// Set APP_PASSWORD in Vercel. Requests authenticate with either the
// "x-app-password" header (fetch calls) or an "app_password" cookie (so
// <img>/<audio>/<video> media requests, which can't set headers, still pass).
// If APP_PASSWORD is not set, access is open.
export function checkAuth(request) {
  const required = process.env.APP_PASSWORD;
  if (!required) return true;

  const header = request.headers.get("x-app-password");
  if (header && header === required) return true;

  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)app_password=([^;]*)/);
  if (match) {
    try {
      if (decodeURIComponent(match[1]) === required) return true;
    } catch {
      // malformed cookie value
    }
  }
  return false;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
