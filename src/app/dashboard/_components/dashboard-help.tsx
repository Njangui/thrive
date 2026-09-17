"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

const GUIDES: Record<string, { title: string; intro: string; steps: string[]; tip?: string }> = {
  "/dashboard/products": {
    title: "Bien gérer votre catalogue",
    intro: "Votre catalogue alimente votre site, vos réponses clients et vos actions commerciales.",
    steps: [
      "Ajoutez le nom, le prix, les photos, la catégorie et le stock.",
      "Laissez le produit en Brouillon tant que toutes les informations ne sont pas prêtes.",
      "Passez-le en Actif pour le rendre visible sur votre site.",
      "Mettez à jour le stock dès qu'une vente est confirmée pour éviter les commandes impossibles.",
    ],
    tip: "Une fiche complète vend mieux : photo claire + prix + description courte + disponibilité.",
  },
  "/dashboard/leads": {
    title: "Faire vivre votre CRM",
    intro: "Le CRM centralise les prospects et vous aide à ne pas oublier les conversations importantes.",
    steps: [
      "Traitez d'abord les prospects récemment actifs.",
      "Vérifiez leur score et l'historique de conversation avant de relancer.",
      "Définissez une prochaine action plutôt que de laisser le prospect sans suivi.",
      "Passez le prospect en client dès que la vente est réellement confirmée.",
    ],
    tip: "CRESYVA propose automatiquement une relance à 24 h ou 48 h selon l'engagement observé.",
  },
  "/dashboard/orders": {
    title: "Traiter une commande",
    intro: "Chaque commande doit suivre un état clair jusqu'à sa livraison ou son annulation.",
    steps: [
      "Ouvrez la commande et vérifiez le client, les articles et le montant.",
      "Confirmez la commande lorsque vous avez validé sa disponibilité.",
      "Faites évoluer son statut au fil du traitement.",
      "Vérifiez le stock après confirmation et avant l'expédition.",
    ],
  },
  "/dashboard/finance": {
    title: "Lire votre situation financière",
    intro: "Utilisez cette page pour suivre les encaissements, dépenses et mouvements enregistrés dans CRESYVA.",
    steps: [
      "Commencez par vérifier la période sélectionnée.",
      "Contrôlez les entrées et sorties avant d'interpréter le résultat.",
      "Ajoutez les opérations manuelles avec un libellé précis.",
      "Utilisez les totaux pour votre suivi interne, puis rapprochez-les de vos moyens de paiement réels.",
    ],
  },
  "/dashboard/subscription": {
    title: "Gérer votre abonnement",
    intro: "Vous pouvez suivre votre offre, votre consommation et vos paiements sans configuration technique.",
    steps: [
      "Consultez votre offre actuelle et ses limites.",
      "Surveillez les jauges avant d'atteindre une limite.",
      "Choisissez une offre supérieure si votre activité dépasse les capacités actuelles.",
      "Conservez vos reçus et vérifiez le statut de chaque paiement.",
    ],
  },
  "/dashboard/addons": {
    title: "Activer un complément",
    intro: "Les compléments ajoutent des capacités à votre offre sans vous demander de connaître l'infrastructure.",
    steps: [
      "Lisez ce que le complément ajoute réellement à votre compte.",
      "Vérifiez son coût et sa périodicité.",
      "Activez-le seulement si votre activité en a besoin.",
      "Retrouvez ensuite son état dans cette même page.",
    ],
  },
  "/dashboard/comments": {
    title: "Gérer les commentaires",
    intro: "Répondez rapidement aux commentaires publics qui peuvent devenir des conversations commerciales.",
    steps: [
      "Commencez par les commentaires récents sans réponse.",
      "Répondez avec une information utile et une prochaine étape claire.",
      "Masquez seulement les contenus qui le justifient.",
      "Pour une demande privée, poursuivez la conversation dans votre messagerie.",
    ],
  },
  "/dashboard/appointments": {
    title: "Gérer vos rendez-vous",
    intro: "Gardez un agenda simple : chaque rendez-vous doit avoir un client, un service, une heure et un statut.",
    steps: [
      "Créez le rendez-vous avec la date et l'heure locales.",
      "Confirmez-le dès que le client a validé.",
      "Passez-le en terminé après la prestation.",
      "Utilisez Annulé ou Absent pour conserver un historique fiable.",
    ],
  },
  "/dashboard/site": {
    title: "Construire votre site",
    intro: "Votre site public est généré depuis les informations de votre entreprise, votre catalogue et vos sections.",
    steps: [
      "Commencez par le logo, la bannière et les informations de contact.",
      "Choisissez les couleurs et la typographie de votre marque.",
      "Activez seulement les sections utiles à votre secteur puis réordonnez-les.",
      "Ajoutez des témoignages et vérifiez le rendu public avant de communiquer le lien.",
    ],
    tip: "Le secteur choisi lors de la création sert de point de départ : vous pouvez ensuite personnaliser librement la page.",
  },
  "/dashboard/channels": {
    title: "Connecter vos canaux",
    intro: "Chaque connexion se fait depuis CRESYVA avec des étapes guidées. Aucun réglage technique n'est nécessaire au quotidien.",
    steps: [
      "Choisissez le canal à connecter.",
      "Suivez l'autorisation officielle affichée par le service concerné.",
      "Revenez dans CRESYVA et vérifiez que le statut passe à Connecté.",
      "Testez ensuite un message ou une publication avant de lancer une campagne.",
    ],
    tip: "Les détails techniques des services utilisés restent volontairement cachés dans l'interface marchand.",
  },
};

function resolveGuide(pathname: string) {
  if (pathname.startsWith("/dashboard/products")) return GUIDES["/dashboard/products"];
  if (pathname.startsWith("/dashboard/leads")) return GUIDES["/dashboard/leads"];
  if (pathname.startsWith("/dashboard/orders")) return GUIDES["/dashboard/orders"];
  if (pathname.startsWith("/dashboard/finance")) return GUIDES["/dashboard/finance"];
  if (pathname.startsWith("/dashboard/subscription")) return GUIDES["/dashboard/subscription"];
  if (pathname.startsWith("/dashboard/addons")) return GUIDES["/dashboard/addons"];
  if (pathname.startsWith("/dashboard/comments")) return GUIDES["/dashboard/comments"];
  if (pathname.startsWith("/dashboard/appointments")) return GUIDES["/dashboard/appointments"];
  if (pathname.startsWith("/dashboard/site")) return GUIDES["/dashboard/site"];
  if (pathname.startsWith("/dashboard/channels")) return GUIDES["/dashboard/channels"];
  return null;
}

export function DashboardHelp() {
  const pathname = usePathname();
  const guide = resolveGuide(pathname);
  const [open, setOpen] = useState(false);
  if (!guide) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-navy-900 px-4 py-3 text-xs font-bold text-white shadow-[0_16px_40px_-18px_rgba(14,17,48,.8)] transition hover:-translate-y-0.5 hover:bg-violet-700"
        aria-label="Ouvrir le guide de cette page"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-white/15">?</span>
        Guide
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/35 p-3 backdrop-blur-[2px] sm:items-center">
          <div className="w-full max-w-lg rounded-[28px] border border-white/60 bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="adm-eyebrow">Guide pratique</p>
                <h2 className="mt-1 font-jakarta text-xl font-extrabold">{guide.title}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Fermer</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">{guide.intro}</p>
            <ol className="mt-5 space-y-3">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex gap-3 rounded-2xl bg-[#F8FAFC] p-3.5 text-sm leading-5 text-slate-700">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-violet-600 text-xs font-bold text-white">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {guide.tip ? <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50 p-4 text-xs leading-5 text-violet-800"><strong>Conseil :</strong> {guide.tip}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
