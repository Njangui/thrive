import { NextResponse } from "next/server";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import { getCurrentUserOrganizations } from "@/application/services/auth-service";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await getSupabaseServerSessionClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Redirige directement vers le dashboard si l'utilisateur a déjà une
  // entreprise, sinon vers l'onboarding (section 31 doc 1).
  const orgs = await getCurrentUserOrganizations();
  const destination = orgs.length > 0 ? "/dashboard" : "/onboarding";

  return NextResponse.redirect(`${origin}${destination}`);
}
