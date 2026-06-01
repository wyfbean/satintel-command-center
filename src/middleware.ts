import { NextResponse, type NextRequest } from "next/server";

/**
 * Global CORS middleware.
 *
 * • Returns a 204 immediately for every OPTIONS preflight so browsers don't
 *   block cross-origin requests to /api/* routes.
 * • The actual CORS response headers (Access-Control-Allow-*) are already
 *   attached by `headers()` in next.config.ts; this file only needs to short-
 *   circuit the preflight before the route handler runs.
 */
export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin") ?? "*";
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":      origin,
        "Access-Control-Allow-Methods":     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers":     "Content-Type,Authorization,X-Requested-With",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age":           "86400",
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  // Only run this middleware on API routes — skip pages, assets, and _next.
  matcher: "/api/:path*",
};
