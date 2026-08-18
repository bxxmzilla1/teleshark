export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical URL of this deployment, managed from Vercel:
 * - APP_URL environment variable if you set one (e.g. https://my-app.vercel.app)
 * - otherwise Vercel's own production URL.
 *
 * The desktop app reads this on every launch and follows it automatically,
 * so changing APP_URL in Vercel re-points the desktop app without retyping.
 * Intentionally public: it only reveals the address you're already visiting.
 */
export async function GET() {
  let url = (process.env.APP_URL || "").trim();
  if (!url && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    url = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (url && !/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return Response.json(
    { url: url.replace(/\/+$/, "") },
    { headers: { "Cache-Control": "no-store" } }
  );
}
