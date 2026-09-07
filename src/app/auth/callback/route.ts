import { NextResponse } from "next/server";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getCurrentUserOrganizations } from "@/application/services/auth-service";

/** `next` doit être un chemin relatif interne — jamais une URL absolue (open redirect). */
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  if (code) {
    const supabase = await getSupabaseServerSessionClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Lot L : un `next` valide (ex: /invite/accept?token=...) prime sur la
  // logique par défaut — sinon un nouvel utilisateur SANS organisation
  // encore serait redirigé vers /onboarding et créerait sa PROPRE
  // organisation au lieu de rejoindre celle qui l'a invité.
  if (next) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Redirige directement vers le dashboard si l'utilisateur a déjà une
  // entreprise, sinon vers l'onboarding (section 31 doc 1).
  const orgs = await getCurrentUserOrganizations();
  const destination = orgs.length > 0 ? "/dashboard" : "/onboarding";

  return NextResponse.redirect(`${origin}${destination}`);
}
