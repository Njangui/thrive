"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { joinCountryWaitlist } from "@/application/services/country-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

/**
 * Country Engine — liste d'attente publique (section 54). Volontairement
 * minimal : pas de compte, pas de session, donc l'IP est le seul signal
 * disponible pour le rate limiting (même limitation que
 * webhooks/notchpay/route.ts, documentée dans src/lib/rate-limit.ts).
 * Toujours passer par cette Server Action — jamais un insert anon-key
 * direct depuis le navigateur (country_waitlist n'a d'ailleurs AUCUNE
 * policy RLS pour les rôles clients, 0040_country_engine.sql : ce
 * chemin service-role est le SEUL moyen d'y écrire).
 */
export async function joinWaitlistAction(formData: FormData) {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() ?? "unknown";

  const retryAfter = await checkRateLimit("waitlist", clientIp);
  if (retryAfter !== null) {
    redirect(`/?waitlist_error=${encodeURIComponent("Trop de tentatives — réessayez dans un instant.")}#disponibilite`);
  }

  const email = String(formData.get("email") ?? "");
  const countryCode = String(formData.get("countryCode") ?? "");
  const companyName = String(formData.get("companyName") ?? "");

  try {
    await joinCountryWaitlist({ email, countryCode, companyName: companyName || undefined });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'inscription à la liste d'attente.";
    redirect(`/?waitlist_error=${encodeURIComponent(message)}#disponibilite`);
  }

  redirect(
    `/?waitlist_success=${encodeURIComponent("Merci ! Nous vous préviendrons dès l'ouverture dans votre pays.")}#disponibilite`,
  );
}
