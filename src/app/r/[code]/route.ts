import { NextResponse } from "next/server";
import { recordClick } from "@/application/services/affiliate-service";
import { AFFILIATE_COOKIE_NAME } from "@/application/services/affiliate-link-security";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Programme d'affiliation (0044) — route PUBLIQUE, aucune authentification.
 * Enregistre le clic (avec heuristiques anti-fraude, voir
 * affiliate-service.ts::recordClick), pose un cookie HttpOnly signé, puis
 * redirige vers la destination du lien (par défaut la page d'accueil).
 *
 * Toujours rediriger vers "/" en cas de code invalide/inactif — jamais
 * une 404 qui confirmerait/infirmerait l'existence d'un code à un
 * visiteur malveillant qui en teste plusieurs.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

  const retryAfter = await checkRateLimit("affiliate_click", clientIp);
  if (retryAfter !== null) {
    // Simple anti-flood (voir lib/rate-limit.ts) : on redirige quand même
    // vers l'accueil plutôt que d'afficher une erreur à un visiteur qui
    // n'y peut rien (le flood vient presque toujours d'un bot, pas du
    // clic légitime qui a déclenché la limite).
    return NextResponse.redirect(new URL("/", request.url));
  }

  const result = await recordClick({
    code,
    ip: clientIp,
    userAgent: request.headers.get("user-agent"),
    refererHost: safeRefererHost(request.headers.get("referer")),
  });

  if (!result) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.redirect(new URL(result.destinationPath, request.url));
  response.cookies.set(AFFILIATE_COOKIE_NAME, result.cookieToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: result.cookieMaxAgeSeconds,
    path: "/",
  });
  return response;
}

function safeRefererHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).host;
  } catch {
    return null;
  }
}
