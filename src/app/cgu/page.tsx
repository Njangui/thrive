import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/_components/legal-page-layout";

export const metadata: Metadata = { title: "Conditions générales d'utilisation — CRESYVA" };

export default function CguPage() {
  return (
    <LegalPageLayout title="Conditions générales d'utilisation (CGU)">
      <p>Dernière mise à jour : [À COMPLÉTER — date].</p>

      <h2>1. Objet</h2>
      <p>
        CRESYVA est une plateforme logicielle (SaaS) permettant à une entreprise (« le Client ») de gérer son
        catalogue de produits/services, son site public, ses communications clients (WhatsApp, réseaux sociaux), sa
        relation client (CRM) et son suivi financier de base, depuis un tableau de bord unique.
      </p>

      <h2>2. Création de compte</h2>
      <p>
        L&apos;accès au service nécessite la création d&apos;un compte et d&apos;une organisation. Le Client
        s&apos;engage à fournir des informations exactes et à maintenir la confidentialité de ses identifiants. Le
        Client est responsable de toute action effectuée depuis son compte, y compris par les membres de son équipe
        qu&apos;il invite.
      </p>

      <h2>3. Offre gratuite, abonnements et paiement</h2>
      <p>
        Une offre gratuite est proposée dès l&apos;inscription, sans limite de durée et sans carte bancaire. Les
        fonctionnalités et les limites propres à chaque offre sont détaillées sur la page tarifs ; certaines
        fonctionnalités sont réservées aux offres payantes, selon les plans et tarifs affichés sur la page tarifs au
        moment de la souscription. Le Client peut à tout moment repasser à l&apos;offre gratuite depuis son tableau
        de bord. Le paiement des offres payantes est traité par notre prestataire de paiement (NotchPay) ; CRESYVA ne
        stocke aucune donnée de carte bancaire ou de compte Mobile Money. Les abonnements payants sont [À COMPLÉTER —
        mensuels/annuels], renouvelés automatiquement sauf résiliation avant la date de renouvellement. [À COMPLÉTER —
        conséquences d&apos;un défaut de paiement sur les fonctionnalités payantes.]
      </p>

      <h2>4. Résiliation</h2>
      <p>
        Le Client peut résilier son abonnement à tout moment depuis son tableau de bord. La résiliation prend effet
        à la fin de la période déjà payée — aucun remboursement au prorata n&apos;est effectué sauf disposition
        légale contraire. [À COMPLÉTER — politique de remboursement le cas échéant].
      </p>

      <h2>5. Propriété des données</h2>
      <p>
        Les données saisies par le Client (catalogue, contacts, conversations, contenu de son site) restent sa
        propriété. CRESYVA ne les utilise que pour fournir le service, et ne les cède ni ne les vend à des tiers —
        voir la <a href="/confidentialite">politique de confidentialité</a>. En cas de résiliation, le Client
        dispose de [À COMPLÉTER — délai] pour exporter ses données avant leur suppression définitive.
      </p>

      <h2>6. Usage acceptable</h2>
      <ul>
        <li>Ne pas utiliser le service à des fins illégales ou frauduleuses.</li>
        <li>Ne pas utiliser les canaux de diffusion (WhatsApp, réseaux sociaux) pour du spam non sollicité.</li>
        <li>Ne pas tenter de contourner les limites techniques ou de sécurité de la plateforme.</li>
        <li>Respecter les conditions d&apos;utilisation propres à chaque canal connecté (WhatsApp/Meta, etc.).</li>
      </ul>

      <h2>7. Disponibilité du service</h2>
      <p>
        CRESYVA met en œuvre des moyens raisonnables pour assurer la disponibilité du service, sans garantie
        d&apos;absence totale d&apos;interruption. Certaines fonctionnalités dépendent de prestataires tiers
        (Zernio pour WhatsApp/réseaux sociaux, NotchPay pour le paiement, OpenProvider pour les domaines) dont la
        disponibilité échappe à notre contrôle direct.
      </p>

      <h2>8. Limitation de responsabilité</h2>
      <p>
        [À COMPLÉTER — clause de limitation de responsabilité, à faire rédiger/valider par un juriste compte tenu
        du droit applicable].
      </p>

      <h2>9. Modification des CGU</h2>
      <p>
        CRESYVA peut modifier les présentes CGU. Le Client sera informé de toute modification substantielle par
        email ou notification dans le tableau de bord, avant son entrée en vigueur.
      </p>

      <h2>10. Droit applicable et litiges</h2>
      <p>
        Les présentes CGU sont soumises au droit [À COMPLÉTER — camerounais / OHADA]. Tout litige sera soumis aux
        juridictions compétentes de [À COMPLÉTER], à défaut de résolution amiable préalable.
      </p>
    </LegalPageLayout>
  );
}
