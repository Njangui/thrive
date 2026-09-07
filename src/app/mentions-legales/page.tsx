import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/_components/legal-page-layout";

export const metadata: Metadata = { title: "Mentions légales — SME-OS" };

export default function MentionsLegalesPage() {
  return (
    <LegalPageLayout title="Mentions légales">
      <h2>Éditeur du site</h2>
      <p>
        Le service SME-OS est édité par <strong>[À COMPLÉTER — dénomination sociale]</strong>, [À COMPLÉTER — forme
        juridique], au capital de [À COMPLÉTER] FCFA, immatriculée au Registre du Commerce et du Crédit Mobilier
        (RCCM) sous le numéro [À COMPLÉTER], dont le siège social est situé [À COMPLÉTER — adresse], [À COMPLÉTER —
        ville, pays].
      </p>
      <p>
        Numéro de contribuable (NIU) : [À COMPLÉTER].
        <br />
        Téléphone : [À COMPLÉTER]. Email : [À COMPLÉTER].
      </p>

      <h2>Directeur de la publication</h2>
      <p>[À COMPLÉTER — nom du représentant légal].</p>

      <h2>Hébergement</h2>
      <p>
        Le site et l&apos;application sont hébergés par Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789,
        États-Unis) — voir <a href="https://vercel.com/legal">vercel.com/legal</a>. Les données sont stockées via
        Supabase (Supabase Inc.) — voir <a href="https://supabase.com/privacy">supabase.com/privacy</a> pour la
        localisation de leurs centres de données.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        La marque SME-OS, son logo, et l&apos;ensemble des éléments graphiques et logiciels de la plateforme sont la
        propriété de [À COMPLÉTER]. Toute reproduction non autorisée est interdite.
      </p>

      <h2>Contact</h2>
      <p>Pour toute question relative à ces mentions légales : [À COMPLÉTER — email de contact].</p>
    </LegalPageLayout>
  );
}
