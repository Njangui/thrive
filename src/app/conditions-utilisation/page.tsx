import { LegalPageShell, LegalSection } from "../_components/legal-page-shell";

export const metadata = {
  title: "Conditions d'utilisation — Thrive",
  description: "Conditions d'utilisation de la plateforme Thrive.",
};

/** Gabarit générique — à faire valider par un juriste avant mise en ligne. */
export default function ConditionsUtilisationPage() {
  return (
    <LegalPageShell title="Conditions d'utilisation" updatedAt="à finaliser avant mise en ligne">
      <LegalSection title="Objet">
        <p>
          Les présentes conditions régissent l&apos;utilisation de la plateforme Thrive, qui permet à une entreprise de
          gérer son catalogue, ses commandes, ses clients et sa communication (WhatsApp, réseaux sociaux) depuis une
          interface unique.
        </p>
      </LegalSection>

      <LegalSection title="Création de compte">
        <p>
          Vous devez fournir des informations exactes lors de la création de votre compte et êtes responsable de la
          confidentialité de vos identifiants.
        </p>
      </LegalSection>

      <LegalSection title="Plans et facturation">
        <p>
          Le plan Starter est gratuit. Les plans payants sont facturés selon la formule choisie ; le détail des tarifs
          est disponible sur la page{" "}
          <a href="/tarifs" className="text-primary hover:underline">
            Tarifs
          </a>
          . Vous pouvez changer de plan ou annuler à tout moment, sans engagement.
        </p>
      </LegalSection>

      <LegalSection title="Usage acceptable">
        <p>
          Vous vous engagez à ne pas utiliser Thrive pour des activités illégales, pour diffuser du contenu
          frauduleux, ou pour envoyer des messages non sollicités en violation des règles des plateformes tierces
          (WhatsApp, réseaux sociaux) auxquelles vous connectez votre compte.
        </p>
      </LegalSection>

      <LegalSection title="Disponibilité du service">
        <p>
          Nous mettons en œuvre des moyens raisonnables pour assurer la disponibilité de la plateforme, sans garantie
          d&apos;absence totale d&apos;interruption, notamment lors de maintenances ou d&apos;incidents chez nos
          prestataires techniques.
        </p>
      </LegalSection>

      <LegalSection title="Résiliation">
        <p>
          Vous pouvez fermer votre compte à tout moment depuis votre tableau de bord ou en nous contactant. Nous
          pouvons suspendre un compte en cas de violation manifeste des présentes conditions.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>Pour toute question sur ces conditions : support@sme-os.app.</p>
      </LegalSection>
    </LegalPageShell>
  );
}
