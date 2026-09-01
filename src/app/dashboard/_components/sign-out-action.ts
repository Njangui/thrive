"use server";

import { redirect } from "next/navigation";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";

/**
 * Aucune fonctionnalité de déconnexion n'existait avant ce lot (vérifié :
 * aucune occurrence de `auth.signOut` dans tout `src/`). Ajoutée ici parce
 * que la nouvelle topbar a un menu profil qui l'appelle réellement — pas un
 * bouton décoratif.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await getSupabaseServerSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
