import { NextResponse } from "next/server";
import { completeYouTubeOAuth } from "@/application/services/youtube-channel-service";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/dashboard/channels?error=Connexion%20YouTube%20incompl%C3%A8te", request.url));
  try {
    // Audit S2 : la session doit exister et correspondre à l'utilisateur qui a lancé la connexion.
    const supabase = await getSupabaseServerSessionClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.redirect(new URL("/login", request.url));
    await completeYouTubeOAuth(code, state, user.id);
    return NextResponse.redirect(new URL("/dashboard/channels?success=YouTube%20connect%C3%A9", request.url));
  } catch (error) {
    return NextResponse.redirect(new URL(`/dashboard/channels?error=${encodeURIComponent(error instanceof Error ? error.message : "Connexion YouTube impossible")}`, request.url));
  }
}
