import { LegalPageShell, LegalSection } from "../_components/legal-page-shell";

export const metadata = {
  title: "Politique de confidentialité — Thrive",
  description: "Comment Thrive collecte, utilise et protège vos données.",
};

/**
 * Gabarit générique décrivant les flux de données RÉELS de l'architecture
 * du produit (Supabase, Zernio, prestataires IA, prestataires de paiement)
 * — mais reste un modèle à faire valider par un juriste avant mise en ligne,
 * pas un document juridiquement engageant tel quel.
 */
export default function ConfidentialitePage() {
  return (
    <LegalPageShell title="Politique de confidentialité" updatedAt="à finaliser avant mise en ligne">
      <LegalSection title="Données que nous collectons">
        <p>Selon votre usage de Thrive, nous traitons :</p>
        <ul className="list-disc pl-5">
          <li>les informations de votre entreprise (nom, coordonnées, catalogue de produits/services) ;</li>
          <li>les informations de vos clients que vous enregistrez (nom, numéro WhatsApp, historique d&apos;échanges) ;</li>
          <li>le contenu des conversations traitées par l&apos;assistant IA, pour vous permettre d&apos;y répondre ;</li>
          <li>les données de connexion et d&apos;usage de votre compte.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Comment nous utilisons ces données">
        <p>
          Ces données servent exclusivement à faire fonctionner votre boutique sur Thrive : afficher votre catalogue,
          gérer vos commandes et rendez-vous, répondre à vos clients et générer vos statistiques. Nous ne vendons
          aucune donnée à des tiers.
        </p>
      </LegalSection>

      <LegalSection title="Sous-traitants et partenaires techniques">
        <p>Pour fonctionner, Thrive s&apos;appuie sur des prestataires techniques, notamment :</p>
        <ul className="list-disc pl-5">
          <li>Supabase, pour l&apos;hébergement de la base de données et des fichiers ;</li>
          <li>un prestataire de messagerie WhatsApp et réseaux sociaux, pour l&apos;envoi et la réception des messages ;</li>
          <li>un ou plusieurs prestataires d&apos;intelligence artificielle, pour générer les réponses automatiques ;</li>
          <li>des prestataires de paiement mobile (Mobile Money) ou en ligne, lorsque vous activez le paiement.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Vos droits">
        <p>
          Vous pouvez demander l&apos;accès, la correction ou la suppression de vos données, ainsi que celles de vos
          clients enregistrées via votre compte, en écrivant à support@sme-os.app.
        </p>
      </LegalSection>

      <LegalSection title="Conservation">
        <p>
          Vos données sont conservées tant que votre compte est actif, puis supprimées ou anonymisées dans un délai
          raisonnable après la fermeture du compte, sauf obligation légale de conservation plus longue.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
