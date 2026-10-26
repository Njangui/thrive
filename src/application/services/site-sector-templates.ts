import { STOREFRONT_BLUEPRINTS } from "@/application/config/storefront-blueprint";

/**
 * Modèles de SITE LIBRE par secteur (santé, éducation) : une page d'accueil et une page d'information composées
 * de blocs riches + sections de données. Données pures (aucune base) ; appliquées par l'opération
 * `apply_sector_template` (site-operations.ts), donc atomiques, revalidées par le schéma, enregistrées dans
 * l'historique et annulables comme n'importe quelle modification.
 *
 * Règles de contenu (mêmes que les gabarits sectoriels) :
 *  - AUCUN chiffre, tarif, délai, diplôme, agrément ou témoignage inventé. Tout ce qui est factuel vient des
 *    sections de données de l'entreprise (consultations/formations, équipe, avis, horaires, adresse).
 *  - Les textes sont des repères génériques, tous modifiables ; aucune promesse médicale ou d'admission.
 *  - Santé : un encadré rappelle que le site n'est pas un service d'urgence.
 */
export const SECTOR_TEMPLATES = ["health", "education"] as const;
export type SectorTemplate = (typeof SECTOR_TEMPLATES)[number];

export interface TemplateBlock { type: string; props: Record<string, unknown> }
export interface TemplatePage { title: string; slug: string; blocks: TemplateBlock[]; inNavigation: boolean }
export interface SectorTemplateContent {
  home: TemplateBlock[];
  pages: TemplatePage[];
  accent: { primary: string; secondary: string };
}

const data = (type: string): TemplateBlock => ({ type, props: {} });

function health(name: string): SectorTemplateContent {
  const b = STOREFRONT_BLUEPRINTS.health;
  return {
    accent: b.defaultAccent,
    home: [
      { type: "rich_hero", props: { eyebrow: b.eyebrow, title: b.heroTitle(name), subtitle: b.heroSubtitle(name), primaryCta: { label: b.primaryCtaLabel, href: "/rendez-vous" }, secondaryCta: { label: b.secondaryCtaLabel, href: "/services" }, layout: "centered", background: "soft", spacing: "spacious" } },
      { type: "feature_grid", props: { heading: "Pourquoi nous consulter", columns: 4, items: [
        { icon: "📅", title: "Rendez-vous en ligne", text: "Demandez un créneau sans vous déplacer." },
        { icon: "🩺", title: "Consultations présentées", text: "Actes et tarifs affichés avant de venir." },
        { icon: "👩‍⚕️", title: "Équipe présentée", text: "Faites connaissance avec les praticiens." },
        { icon: "💬", title: "Un contact simple", text: "Une question ? Écrivez-nous sur WhatsApp." },
      ] } },
      data("services"),
      { type: "steps", props: { heading: "Comment prendre rendez-vous", background: "soft", items: [
        { title: "Choisissez une consultation", text: "Parcourez les consultations et les actes proposés." },
        { title: "Demandez un créneau", text: "Indiquez le jour qui vous convient." },
        { title: "Recevez la confirmation", text: "L'équipe vous répond pour confirmer le rendez-vous." },
        { title: "Préparez votre venue", text: "Retrouvez les informations utiles avant de venir." },
      ] } },
      data("team"),
      { type: "rich_text", props: { eyebrow: "Important", heading: "Urgence médicale", body: "Ce site ne remplace pas un service d'urgence. En cas d'urgence vitale, appelez les secours de votre pays ou rendez-vous directement aux urgences les plus proches.", background: "soft" } },
      data("testimonials"),
      data("faq"),
      data("location"),
      data("contact"),
      { type: "cta_band", props: { heading: "Besoin d'une consultation ?", text: "Demandez votre rendez-vous en quelques clics.", cta: { label: b.primaryCtaLabel, href: "/rendez-vous" } } },
    ],
    pages: [{
      title: "Informations patients", slug: "infos-patients", inNavigation: true,
      blocks: [
        { type: "feature_grid", props: { heading: "Avant votre venue", subtitle: "Quelques repères pour que votre consultation se passe bien.", columns: 2, items: [
          { icon: "🪪", title: "Pièce d'identité", text: "Pensez à l'apporter, ainsi que votre carnet de santé si vous en avez un." },
          { icon: "📄", title: "Documents médicaux", text: "Ordonnances, résultats d'examens et comptes rendus récents." },
          { icon: "💊", title: "Traitements en cours", text: "Notez les médicaments que vous prenez déjà pour en informer le praticien." },
          { icon: "⏰", title: "Rendez-vous", text: "En cas d'empêchement, prévenez-nous afin de libérer le créneau." },
        ] } },
        data("faq"),
        data("contact"),
      ],
    }],
  };
}

function education(name: string): SectorTemplateContent {
  const b = STOREFRONT_BLUEPRINTS.education;
  return {
    accent: b.defaultAccent,
    home: [
      { type: "rich_hero", props: { eyebrow: b.eyebrow, title: b.heroTitle(name), subtitle: b.heroSubtitle(name), primaryCta: { label: b.primaryCtaLabel, href: "/rendez-vous" }, secondaryCta: { label: b.secondaryCtaLabel, href: "/services" }, layout: "centered", background: "soft", spacing: "spacious" } },
      { type: "feature_grid", props: { heading: "Pourquoi nous rejoindre", columns: 4, items: [
        { icon: "🎓", title: "Programmes détaillés", text: "Durée, contenu et frais présentés clairement." },
        { icon: "🤝", title: "Inscription guidée", text: "L'équipe répond à vos questions pas à pas." },
        { icon: "🏫", title: "Visites et entretiens", text: "Rencontrez l'admission avant de vous décider." },
        { icon: "👩‍🏫", title: "Équipe pédagogique", text: "Découvrez ceux qui vous accompagnent." },
      ] } },
      data("services"),
      { type: "steps", props: { heading: "Comment s'inscrire", background: "soft", items: [
        { title: "Choisissez votre formation", text: "Comparez les programmes, la durée et les frais." },
        { title: "Contactez l'admission", text: "Posez vos questions ou demandez une visite ou un entretien." },
        { title: "Constituez votre dossier", text: "L'admission vous indique les pièces à fournir." },
        { title: "Confirmez votre inscription", text: "Finalisez avec l'établissement selon ses modalités de paiement." },
      ] } },
      data("team"),
      data("gallery"),
      data("testimonials"),
      data("faq"),
      data("location"),
      data("contact"),
      { type: "cta_band", props: { heading: "Prêt à commencer ?", text: "Demandez une visite ou un entretien d'admission.", cta: { label: b.primaryCtaLabel, href: "/rendez-vous" } } },
    ],
    pages: [{
      title: "Admissions", slug: "admissions", inNavigation: true,
      blocks: [
        { type: "rich_text", props: { heading: "Constituer votre dossier", body: "Selon la formation, l'admission peut demander une pièce d'identité, vos derniers diplômes ou relevés de notes et des photos d'identité. La liste exacte et les dates limites vous sont confirmées par l'équipe d'admission." } },
        { type: "steps", props: { heading: "Les étapes", items: [
          { title: "Demande d'information", text: "Écrivez-nous ou demandez une visite." },
          { title: "Entretien ou étude du dossier", text: "L'établissement examine votre candidature." },
          { title: "Décision et inscription", text: "Vous êtes informé de la suite à donner." },
        ] } },
        data("faq"),
        data("contact"),
      ],
    }],
  };
}

export function buildSectorTemplate(template: SectorTemplate, businessName: string): SectorTemplateContent {
  const name = businessName.trim() || "notre établissement";
  return template === "health" ? health(name) : education(name);
}
