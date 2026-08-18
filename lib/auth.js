// Simple password gate for the whole app.
// Set APP_PASSWORD in Vercel; every API request must send it in the
// "x-app-password" header. If APP_PASSWORD is not set, access is open.
export function checkAuth(request) {
  const required = process.env.APP_PASSWORD;
  if (!required) return true;
  return request.headers.get("x-app-password") === required;
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
