import type { PlanKey } from "@/application/services/plans-repository";

export const PLAN_ORDER: PlanKey[] = ["starter", "business", "pro"];

export const PRICING_FEATURES = [
  { key: "core_dashboard", label: "Tableau de bord métier", kind: "core" as const },
  { key: "catalog", label: "Catalogue / produits / prestations", kind: "core" as const },
  { key: "landing", label: "Vitrine publique personnalisable", kind: "core" as const },
  { key: "crm", label: "Clients & prospects", kind: "core" as const },
  { key: "faq", label: "FAQ structurée", kind: "core" as const },
  { key: "finance", label: "Finance légère", kind: "core" as const },
  { key: "whatsapp", label: "WhatsApp", kind: "core" as const },
  { key: "whatsapp_groups", label: "Groupes WhatsApp", kind: "entitlement" as const },
  { key: "broadcast_contacts", label: "Contacts par diffusion", kind: "entitlement" as const },
  { key: "ai_credits", label: "Crédits Assistant IA / mois", kind: "entitlement" as const },
  { key: "social_accounts", label: "Comptes réseaux sociaux", kind: "entitlement" as const },
  { key: "facebook_messenger", label: "Facebook Messenger", kind: "entitlement" as const },
  { key: "instagram_messages", label: "Messages Instagram", kind: "entitlement" as const },
  { key: "linkedin", label: "LinkedIn", kind: "entitlement" as const },
  { key: "tiktok", label: "TikTok", kind: "entitlement" as const },
  { key: "appointments", label: "Rendez-vous selon votre activité", kind: "core" as const },
  { key: "orders", label: "Commandes selon votre activité", kind: "core" as const },
  { key: "inventory", label: "Gestion du stock selon votre activité", kind: "core" as const },
  { key: "marketing", label: "Publications & marketing", kind: "core" as const },
];

export const RECOMMENDED_PLAN_PRICES: Record<PlanKey, number> = {
  starter: 9900,
  business: 19900,
  pro: 39900,
};
