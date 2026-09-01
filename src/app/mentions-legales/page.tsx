import { LegalPageShell, LegalSection } from "../_components/legal-page-shell";

export const metadata = {
  title: "Mentions légales — Thrive",
  description: "Informations légales relatives à l'éditeur de la plateforme Thrive.",
};

/**
 * Gabarit générique — les champs entre crochets doivent être complétés
 * avec les vraies informations de la société éditrice avant mise en ligne
 * (aucune entité légale réelle n'est définie dans ce projet à ce stade).
 */
export default function MentionsLegalesPage() {
  return (
    <LegalPageShell title="Mentions légales">
      <LegalSection title="Éditeur">
        <p>
          La plateforme Thrive est éditée par [Raison sociale à compléter], [forme juridique], immatriculée sous le
          numéro [numéro d&apos;immatriculation], dont le siège social est situé à [adresse, ville, Cameroun].
        </p>
        <p>Contact : support@sme-os.app</p>
      </LegalSection>

      <LegalSection title="Directeur de la publication">
        <p>[Nom du responsable de la publication à compléter].</p>
      </LegalSection>

      <LegalSection title="Hébergement">
        <p>
          Les données de la plateforme sont hébergées par Supabase (base de données et stockage) ainsi que par
          l&apos;hébergeur de l&apos;application web. Les coordonnées complètes de ces hébergeurs sont disponibles sur
          demande à l&apos;adresse ci-dessus.
        </p>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          L&apos;ensemble des éléments de la plateforme Thrive (marque, logo, interface, textes) est protégé par le
          droit de la propriété intellectuelle. Toute reproduction non autorisée est interdite.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
