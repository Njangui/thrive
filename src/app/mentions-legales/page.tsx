import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/_components/legal-page-layout";
import { buildMarketingMetadata } from "@/app/_lib/marketing-page";
import { LEGAL_ENTITY, isLegalEntityComplete, legalField } from "@/application/config/legal-entity";

export async function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata({
    path: "/mentions-legales",
    title: "Mentions légales — Flexco",
    description: "Éditeur, hébergeur et informations légales du service Flexco.",
    // Une page légale à trous n'a pas à être indexée (voir legal-entity.ts).
    noIndex: !isLegalEntityComplete(),
  });
}

export default function MentionsLegalesPage() {
  const entity = LEGAL_ENTITY;
  const companyName = legalField(entity.companyName, "dénomination sociale");

  return (
    <LegalPageLayout title="Mentions légales">
      <h2>Éditeur du site</h2>
      <p>
        Le service Flexco est édité par <strong>{companyName}</strong>, {legalField(entity.legalForm, "forme juridique")}
        {entity.shareCapital.trim() ? `, au capital de ${entity.shareCapital.trim()} FCFA` : ""}, immatriculée au
        Registre du Commerce et du Crédit Mobilier (RCCM) sous le numéro {legalField(entity.rccm, "numéro RCCM")}, dont
        le siège social est situé {legalField(entity.address, "adresse")}, {legalField(entity.city, "ville")},{" "}
        {legalField(entity.country, "pays")}.
      </p>
      <p>
        Numéro d&apos;identifiant unique du contribuable (NIU) : {legalField(entity.niu, "NIU")}.
        <br />
        {entity.phone.trim() ? `Téléphone : ${entity.phone.trim()}. ` : ""}Email :{" "}
        {legalField(entity.contactEmail, "email de contact")}.
      </p>

      <h2>Directeur de la publication</h2>
      <p>{legalField(entity.publicationDirector, "nom du représentant légal")}.</p>

      <h2>Hébergement</h2>
      <p>
        Le site et l&apos;application sont hébergés par Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789,
        États-Unis) — voir <a href="https://vercel.com/legal">vercel.com/legal</a>. Les données sont stockées via
        Supabase (Supabase Inc.) — voir <a href="https://supabase.com/privacy">supabase.com/privacy</a> pour la
        localisation de leurs centres de données.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        La marque Flexco, son logo, et l&apos;ensemble des éléments graphiques et logiciels de la plateforme sont la
        propriété de {companyName}. Toute reproduction non autorisée est interdite.
      </p>

      <h2>Contact</h2>
      <p>
        Pour toute question relative à ces mentions légales : {legalField(entity.contactEmail, "email de contact")}.
      </p>
    </LegalPageLayout>
  );
}
