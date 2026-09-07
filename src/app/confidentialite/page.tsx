import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/_components/legal-page-layout";

export const metadata: Metadata = { title: "Politique de confidentialité — SME-OS" };

export default function ConfidentialitePage() {
  return (
    <LegalPageLayout title="Politique de confidentialité">
      <p>Dernière mise à jour : [À COMPLÉTER — date].</p>

      <h2>1. Deux niveaux de données</h2>
      <p>
        SME-OS traite deux catégories de données bien distinctes :
      </p>
      <ul>
        <li>
          <strong>Les données du Client</strong> (l&apos;entreprise utilisatrice) : compte, informations
          d&apos;entreprise, facturation.
        </li>
        <li>
          <strong>Les données que le Client saisit ou reçoit via la plateforme</strong> concernant SES PROPRES
          clients (contacts, conversations WhatsApp, commandes) — le Client en est le responsable de traitement ;
          SME-OS agit comme sous-traitant technique pour cette partie-là, au sens du droit applicable à la
          protection des données.
        </li>
      </ul>

      <h2>2. Données collectées</h2>
      <ul>
        <li>Compte : nom, email, mot de passe (chiffré), rôle dans l&apos;organisation.</li>
        <li>Entreprise : nom, secteur, adresse, téléphone, horaires, logo, informations affichées sur le site public.</li>
        <li>Catalogue : produits, services, prix, photos, stock.</li>
        <li>
          Relation client : contacts, conversations et messages échangés via les canaux connectés (WhatsApp,
          réseaux sociaux), commandes, rendez-vous.
        </li>
        <li>Finance : lignes de revenus/dépenses saisies par le Client.</li>
        <li>
          Usage et navigation : pages vues, clics, événements d&apos;analytics agrégés — utilisés pour les
          statistiques affichées au Client sur son propre tableau de bord, jamais revendus.
        </li>
        <li>Paiement : le numéro de carte/Mobile Money n&apos;est jamais stocké par SME-OS — traité directement par NotchPay.</li>
      </ul>

      <h2>3. Sous-traitants (prestataires tiers)</h2>
      <p>Selon les fonctionnalités activées par le Client, certaines données transitent par :</p>
      <ul>
        <li><strong>Supabase</strong> — hébergement de la base de données et de l&apos;authentification.</li>
        <li><strong>Vercel</strong> — hébergement de l&apos;application.</li>
        <li><strong>Zernio</strong> — messagerie WhatsApp et publication sur les réseaux sociaux connectés.</li>
        <li><strong>NotchPay</strong> — traitement des paiements d&apos;abonnement.</li>
        <li><strong>Resend</strong> — envoi des emails transactionnels (invitations d&apos;équipe).</li>
        <li><strong>OpenProvider</strong> — recherche et enregistrement de noms de domaine, si utilisé.</li>
      </ul>
      <p>Chacun de ces prestataires est tenu par ses propres conditions de confidentialité et de sécurité.</p>

      <h2>4. Finalités du traitement</h2>
      <p>
        Les données sont utilisées exclusivement pour fournir le service (faire fonctionner le catalogue, le site,
        les conversations, la facturation), améliorer le produit, et assurer la sécurité de la plateforme.
        Jamais revendues à des tiers à des fins publicitaires.
      </p>

      <h2>5. Durée de conservation</h2>
      <p>
        Les données sont conservées tant que le compte est actif, puis pendant [À COMPLÉTER — durée] après
        résiliation pour permettre un export, avant suppression définitive — sauf obligation légale de conservation
        plus longue (ex. données comptables).
      </p>

      <h2>6. Droits du Client et de ses utilisateurs</h2>
      <p>
        Toute personne concernée peut demander l&apos;accès, la rectification ou la suppression de ses données
        personnelles en écrivant à [À COMPLÉTER — email de contact dédié à la confidentialité]. Pour les données
        des clients FINAUX du Client (contacts WhatsApp, leads), la demande doit être adressée directement au
        Client concerné, responsable de traitement de ces données.
      </p>

      <h2>7. Cookies et sessions</h2>
      <p>
        SME-OS utilise uniquement des cookies strictement nécessaires (session de connexion, préférences
        d&apos;affichage) — aucun cookie publicitaire ou de traçage tiers.
      </p>

      <h2>8. Sécurité</h2>
      <p>
        Isolation stricte des données entre chaque entreprise cliente (contrôle d&apos;accès au niveau base de
        données), chiffrement des mots de passe et des identifiants de connexion aux services tiers, connexions
        chiffrées (HTTPS) de bout en bout.
      </p>

      <h2>9. Contact</h2>
      <p>Pour toute question relative à cette politique : [À COMPLÉTER — email de contact].</p>
    </LegalPageLayout>
  );
}
