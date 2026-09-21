import type { Metadata } from "next";
import type { ReactNode } from "react";
import { buildMarketingMetadata } from "@/app/_lib/marketing-page";

/**
 * `signup/page.tsx` est un composant client (`"use client"`) : il ne peut pas
 * exporter de métadonnées, et héritait donc du titre générique du layout
 * racine — le même que la landing. Ce layout serveur lui en donne un propre.
 *
 * La page reste indexable sur le domaine de la plateforme (page de
 * conversion ; on ne la déclare pas dans le sitemap) et `noindex` sous un
 * domaine de commerçant, où le routage par hôte l'expose aussi (voir
 * `buildMarketingMetadata`).
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata({
    path: "/signup",
    title: "Créer un compte — CRESYVA",
    description:
      "Créez votre compte CRESYVA : catalogue, WhatsApp, réseaux sociaux, clients et finances au même endroit.",
  });
}

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
