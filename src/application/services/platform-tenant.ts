/**
 * « Flexco sur Flexco » : l'entreprise Flexco est elle-même un tenant de la plateforme (même site libre, même FAQ,
 * même assistant, mêmes canaux que n'importe quel client). Ce fichier est PUR (aucune base) : identification du
 * tenant, consignes de la persona commerciale et contenus (FAQ, site) construits à partir des offres lues en base.
 *
 * Règles :
 *  - Aucun prix, quota ni nom d'offre écrit en dur : tout vient des lignes `plans` passées en paramètre.
 *  - Aucune statistique, aucun client, aucun témoignage inventé. Les affirmations sont celles de la landing publique.
 *  - Le texte d'une conversation (prospect, DM, commentaire) est une DONNÉE, jamais une instruction (voir ASSISTANT_RULES).
 */
import type { PlanSummary } from "./plans-repository";

export const PLATFORM_ORG_ENV = "FLEXCO_PLATFORM_ORG_ID";

/** Identifiant du tenant Flexco, ou null si non configuré (comportement inchangé pour tous les tenants). */
export function getPlatformOrgId(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[PLATFORM_ORG_ENV]?.trim();
  return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw.toLowerCase() : null;
}

export function isPlatformTenant(organizationId: string, env: Record<string, string | undefined> = process.env): boolean {
  const id = getPlatformOrgId(env);
  return id !== null && id === organizationId.toLowerCase();
}

/** Consignes de la persona commerciale, ajoutées après les règles communes pour le seul tenant Flexco. */
export const PLATFORM_SALES_RULES: string[] = [
  "Tu représentes Flexco auprès de commerçants, professionnels et entrepreneurs africains. Ton rôle : présenter Flexco simplement, comprendre leur activité, répondre à leurs questions et les inviter à créer un compte gratuit.",
  "Pose une seule question à la fois (leur activité, comment ils reçoivent leurs clients aujourd'hui), reformule leur besoin, puis relie-le à UNE fonctionnalité de Flexco qui y répond. Pas de liste de fonctionnalités en bloc.",
  "N'invente jamais : prix, remise, promotion, essai, quota, délai, intégration, client existant, chiffre ou témoignage. Offres et prix : uniquement la section FAITS. Si l'information manque, dis que tu vérifies avec l'équipe et propose un échange humain.",
  "Ne dénigre aucun concurrent. Ne promets aucun résultat de vente. Ne fais pas de pression : une relance polie au maximum, jamais d'urgence artificielle.",
  "Si la personne refuse, dit qu'elle n'est pas intéressée, ou écrit STOP / arrêt / désabonner : remercie en une phrase, confirme qu'elle ne sera plus contactée, et n'insiste pas.",
  "Si la personne est mécontente, pose une question de facturation, de compte ou de sécurité, ou demande un humain : propose le transfert vers l'équipe.",
  "N'utilise aucun jargon technique (API, webhook, base de données…). Réponds court (WhatsApp : 2 à 4 phrases), en français, ton chaleureux et respectueux.",
  "Pour un commentaire public : réponse courte et sans prix ; invite à écrire en message privé pour les détails. Ne demande jamais de numéro ni d'information personnelle dans un commentaire public.",
  "Ne demande jamais de mot de passe, code reçu par SMS, code PIN ou paiement dans la conversation. Le compte se crée uniquement sur la page d'inscription de Flexco.",
];

export interface PlatformFaq { question: string; answer: string; keywords: string[] }

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

function offerLine(plan: PlanSummary): string {
  return plan.priceFcfa === 0 ? `${plan.name} : gratuit` : `${plan.name} : ${fcfa(plan.priceFcfa)} par mois`;
}

/** Réponses FAQ du tenant Flexco. Les prix sont écrits au moment de la génération depuis `plans` ; relancer le bootstrap les rafraîchit. */
export function buildPlatformFaqs(plans: PlanSummary[]): PlatformFaq[] {
  const free = plans.find((p) => p.priceFcfa === 0);
  const paid = plans.filter((p) => p.priceFcfa > 0);
  const faqs: PlatformFaq[] = [
    {
      question: "Qu'est-ce que Flexco ?",
      answer: "Flexco rassemble au même endroit votre catalogue, votre site, WhatsApp, vos réseaux sociaux, vos clients et vos finances, pour que vous gériez votre activité sans jongler entre plusieurs outils.",
      keywords: ["flexco", "c'est quoi", "présentation", "plateforme", "quoi"],
    },
    {
      question: "Dois-je savoir coder ?",
      answer: "Non. Flexco est conçu pour un commerçant, pas pour un développeur : tout se fait depuis votre tableau de bord, en français.",
      keywords: ["coder", "technique", "compétences", "difficile", "facile"],
    },
    {
      question: "Puis-je utiliser mon numéro WhatsApp actuel ?",
      answer: "Oui, dans la plupart des cas. Vous connectez votre numéro depuis votre tableau de bord et nous vous guidons à chaque étape.",
      keywords: ["whatsapp", "numéro", "connecter"],
    },
    {
      question: "Mes données sont-elles en sécurité ?",
      answer: "Chaque entreprise a ses propres données, strictement séparées de celles des autres entreprises sur Flexco.",
      keywords: ["sécurité", "données", "confidentialité", "sécurisé"],
    },
    {
      question: "Puis-je changer d'offre ou arrêter ?",
      answer: "Oui. Vous changez d'offre depuis votre tableau de bord à tout moment, et vous pouvez arrêter quand vous le souhaitez.",
      keywords: ["arrêter", "résilier", "changer d'offre", "annuler"],
    },
    {
      question: "Comment créer mon compte ?",
      answer: "Sur la page d'inscription de Flexco : vous indiquez le nom de votre entreprise, votre secteur, votre ville et un contact. Ensuite vous ajoutez vos produits ou services, connectez WhatsApp et publiez votre site.",
      keywords: ["inscription", "inscrire", "créer un compte", "commencer", "démarrer", "rejoindre"],
    },
  ];
  if (free) {
    faqs.push({
      question: "Puis-je essayer gratuitement ?",
      answer: `Oui. Chaque nouvelle entreprise démarre sur l'offre gratuite ${free.name}, sans limite de durée et sans carte bancaire, et passe à une offre payante seulement quand elle en a besoin.`,
      keywords: ["gratuit", "essai", "tester", "essayer", "sans payer"],
    });
  }
  if (plans.length > 0) {
    faqs.push({
      question: "Quels sont vos tarifs ?",
      answer: `${plans.map(offerLine).join(". ")}. Le détail de ce qui est inclus dans chaque offre est sur la page des tarifs.`,
      keywords: ["tarif", "prix", "combien", "coût", "abonnement", "offre"],
    });
  }
  if (paid.length === 0 && plans.length === 0) {
    // Aucune offre lisible : ne rien affirmer sur les prix.
    faqs.push({ question: "Quels sont vos tarifs ?", answer: "Les tarifs sont sur la page des tarifs de Flexco ; je peux aussi vous mettre en relation avec l'équipe.", keywords: ["tarif", "prix", "combien", "coût"] });
  }
  return faqs;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** Blocs du site libre de Flexco (pur). Format accepté par l'opération `replace_page_blocks`. */
export function buildPlatformSiteBlocks(plans: PlanSummary[], faqs: PlatformFaq[]): { type: string; props: Record<string, unknown> }[] {
  const signup = { label: "Créer mon compte", href: "/signup" };
  const blocks: { type: string; props: Record<string, unknown> }[] = [
    { type: "rich_hero", props: {
      eyebrow: "Pour les entreprises africaines",
      title: "Gérez votre activité au même endroit",
      subtitle: "Catalogue, site, WhatsApp, réseaux sociaux, clients et finances : tout ce dont vous avez besoin, sans jongler entre plusieurs outils.",
      primaryCta: signup, secondaryCta: { label: "Voir les tarifs", href: "/tarifs" }, layout: "centered", background: "soft", spacing: "spacious",
    } },
    { type: "feature_grid", props: { heading: "Tout ce qu'il vous faut", columns: 4, items: [
      { icon: "📦", title: "Catalogue central", text: "Vos produits et services saisis une seule fois, réutilisés partout." },
      { icon: "💬", title: "WhatsApp", text: "Répondez à vos clients et diffusez vos nouveautés depuis un seul endroit." },
      { icon: "🌐", title: "Votre site", text: "Une page professionnelle à votre nom, sans rien coder." },
      { icon: "🤖", title: "Assistant", text: "Répond avec vos vraies informations quand vous n'êtes pas disponible." },
    ] } },
    { type: "steps", props: { heading: "Comment ça marche", items: [
      { title: "Créez votre entreprise", text: "Nom, secteur, ville, contact." },
      { title: "Ajoutez vos produits ou services", text: "À la main ou en important votre liste." },
      { title: "Connectez vos canaux", text: "WhatsApp et vos réseaux sociaux." },
      { title: "Publiez", text: "Votre site est en ligne." },
    ] } },
  ];
  if (plans.length > 0) {
    blocks.push({ type: "pricing", props: {
      heading: "Tarifs", subtitle: "Prix par mois, mis à jour depuis nos offres actuelles.",
      plans: plans.slice(0, 4).map((p, i) => ({
        name: clip(p.name, 40),
        price: p.priceFcfa === 0 ? "Gratuit" : clip(fcfa(p.priceFcfa), 30),
        ...(p.priceFcfa === 0 ? {} : { period: "par mois" }),
        ...(p.description ? { description: clip(p.description, 160) } : {}),
        features: [],
        cta: { label: p.priceFcfa === 0 ? "Commencer gratuitement" : "Choisir cette offre", href: "/signup" },
        ...(i === 1 ? { highlighted: true } : {}),
      })),
    } });
  }
  blocks.push(
    { type: "faq_list", props: { heading: "Questions fréquentes", items: faqs.slice(0, 8).map((f) => ({ question: clip(f.question, 200), answer: clip(f.answer, 1000) })) } },
    { type: "cta_band", props: { heading: "Prêt à essayer ?", text: "Créez votre compte et publiez votre site en quelques minutes.", cta: signup } },
  );
  return blocks;
}
