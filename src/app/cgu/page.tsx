import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/_components/legal-page-layout";
import { buildMarketingMetadata } from "@/app/_lib/marketing-page";
import { LEGAL_ENTITY, isLegalEntityComplete, legalField } from "@/application/config/legal-entity";

export async function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata({
    path: "/cgu",
    title: "Conditions générales d'utilisation — tokoo ",
    description: "Les conditions d'utilisation de la plateforme tokoo  : compte, abonnements, paiement et responsabilités.",
    // Une page légale à trous n'a pas à être indexée (voir legal-entity.ts).
    noIndex: !isLegalEntityComplete(),
  });
}

export default function CguPage() {
  const entity = LEGAL_ENTITY;

  return (
    <LegalPageLayout title="Conditions générales d'utilisation (CGU)">
      <p>Dernière mise à jour : {entity.lastUpdated}.</p>

      <h2>1. Objet</h2>
      <p>
        tokoo  est une plateforme logicielle (SaaS) permettant à une entreprise (« le Client ») de gérer son
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
        de bord. Le paiement des offres payantes est traité par notre prestataire de paiement (Fapshi) ; tokoo  ne
        stocke aucune donnée de carte bancaire ou de compte Mobile Money.
      </p>
      <p>
        Chaque paiement d&apos;une offre payante donne droit à une période d&apos;un (1) mois. L&apos;abonnement
        n&apos;est pas reconduit automatiquement et aucun prélèvement automatique n&apos;est effectué : le Client
        renouvelle son offre en effectuant un nouveau paiement depuis la rubrique « Mon abonnement » de son tableau
        de bord. tokoo  s&apos;efforce de lui envoyer un rappel environ trois (3) jours avant l&apos;échéance. Si
        l&apos;échéance est dépassée sans paiement, l&apos;abonnement passe en statut « en retard de paiement » et le
        Client en est notifié ; il peut alors renouveler son offre ou repasser à l&apos;offre gratuite. Les
        fonctionnalités réservées aux offres payantes peuvent être limitées tant que l&apos;abonnement n&apos;est pas
        renouvelé.
      </p>

      <h2>4. Fin de l&apos;abonnement</h2>
      <p>
        L&apos;abonnement payant n&apos;étant pas reconduit automatiquement, il prend fin à l&apos;échéance de la
        période payée si le Client ne le renouvelle pas. Le Client peut aussi, à tout moment, repasser à
        l&apos;offre gratuite depuis « Mon abonnement » : ce changement est immédiat, et la partie de la période
        payée non consommée n&apos;est pas remboursée, sauf disposition légale contraire.
      </p>

      <h2>5. Propriété des données</h2>
      <p>
        Les données saisies par le Client (catalogue, contacts, conversations, contenu de son site) restent sa
        propriété. tokoo  ne les utilise que pour fournir le service, et ne les cède ni ne les vend à des tiers —
        voir la <a href="/confidentialite">politique de confidentialité</a>. En cas de fermeture de son
        compte, le Client dispose de {legalField(entity.postClosureRetention, "délai d'export des données")} pour
        exporter ses données avant leur suppression définitive.
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
        tokoo  met en œuvre des moyens raisonnables pour assurer la disponibilité du service, sans garantie
        d&apos;absence totale d&apos;interruption. Certaines fonctionnalités dépendent de prestataires tiers
        (Zernio pour WhatsApp/réseaux sociaux, Fapshi pour le paiement, OpenProvider pour les domaines) dont la
        disponibilité échappe à notre contrôle direct.
      </p>

      <h2>8. Limitation de responsabilité</h2>
      <p>
        tokoo  est tenue à une obligation de moyens. Dans la mesure permise par la loi, tokoo  ne saurait être
        tenue responsable des dommages indirects (perte de chiffre d&apos;affaires, de clientèle ou d&apos;image),
        des interruptions ou dysfonctionnements imputables aux prestataires tiers mentionnés à l&apos;article 7, à un
        cas de force majeure ou à un usage non conforme du service par le Client, ni de la perte de données non
        exportées par le Client. Toujours dans la mesure permise par la loi, la responsabilité totale de tokoo  au
        titre du service est limitée aux sommes effectivement payées par le Client au cours des douze (12) derniers
        mois.
      </p>

      <h2>9. Modification des CGU</h2>
      <p>
        tokoo  peut modifier les présentes CGU. Le Client sera informé de toute modification substantielle par
        email ou notification dans le tableau de bord, avant son entrée en vigueur.
      </p>

      <h2>10. Droit applicable et litiges</h2>
      <p>
        Les présentes CGU sont soumises au droit camerounais, y compris les actes uniformes de l&apos;OHADA
        applicables. Tout litige sera soumis aux juridictions compétentes de{" "}
        {legalField(entity.jurisdictionCity, "ville du tribunal compétent")}, à défaut de résolution amiable
        préalable.
      </p>
    </LegalPageLayout>
  );
}
