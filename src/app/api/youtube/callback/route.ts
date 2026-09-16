import { NextResponse } from "next/server";
import { completeYouTubeOAuth } from "@/application/services/youtube-channel-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/dashboard/channels?error=Connexion%20YouTube%20incompl%C3%A8te", request.url));
  try {
    await completeYouTubeOAuth(code, state);
    return NextResponse.redirect(new URL("/dashboard/channels?success=YouTube%20connect%C3%A9", request.url));
  } catch (error) {
    return NextResponse.redirect(new URL(`/dashboard/channels?error=${encodeURIComponent(error instanceof Error ? error.message : "Connexion YouTube impossible")}`, request.url));
  }
}
