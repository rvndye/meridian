/**
 * Route protection: when APP_PASSWORD is set, every page and API route
 * requires the sealed session cookie, except the login endpoints.
 */
import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export async function middleware(req: NextRequest) {
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const res = NextResponse.next();
  const session = await getIronSession<{ authenticated?: boolean }>(req, res, {
    cookieName: "meridian_session",
    password:
      process.env.SESSION_SECRET ??
      "dev-only-secret-not-for-production-use-1234",
  });

  if (session.authenticated !== true) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination (path + query) so flows that return from an
    // external redirect — e.g. Plaid OAuth with its oauth_state_id — resume
    // after login instead of dead-ending at the dashboard.
    const dest = req.nextUrl.pathname + req.nextUrl.search;
    url.search = dest !== "/" ? `?next=${encodeURIComponent(dest)}` : "";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Everything except Next internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico)$).*)"],
};
