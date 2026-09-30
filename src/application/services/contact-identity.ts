/**
 * Identité d'un contact CRM par plateforme — fonctions PURES (testées en
 * isolation, aucun accès base).
 *
 * Données déjà capturées à la réception d'un message (conversation-service.ts) :
 * - WhatsApp : `phone_e164` (unique par organisation) — deux contacts de même
 *   nom mais de numéros différents sont déjà deux lignes distinctes ;
 * - autres plateformes (Facebook, Instagram, Telegram…) : `external_channel_id`
 *   = "<plateforme>:<identifiant plateforme>" (migration 0046, unique par org).
 *
 * Ce module ne fait que les RENDRE lisibles (référence courte, plateforme,
 * identifiant plateforme) pour que le commerçant distingue deux homonymes.
 */

/** Référence courte et stable dérivée de l'UUID du contact (ex. « CT-3F9A1C2B »). */
export function contactReference(contactId: string | null | undefined): string {
  if (!contactId) return "—";
  return `CT-${contactId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export interface ContactIdentity {
  /** Plateforme d'origine (`whatsapp`, `facebook`, `instagram`, `telegram`…) ou null si inconnue. */
  platform: string | null;
  /** Identifiant unique côté plateforme (ID Facebook, ID Telegram…) ; pour WhatsApp, le numéro. */
  platformId: string | null;
}

export function resolveContactIdentity(input: {
  phone?: string | null;
  externalChannelId?: string | null;
  sourceChannel?: string | null;
}): ContactIdentity {
  const external = input.externalChannelId?.trim();
  if (external) {
    const separator = external.indexOf(":");
    if (separator > 0) {
      return { platform: external.slice(0, separator), platformId: external.slice(separator + 1) || null };
    }
    return { platform: input.sourceChannel ?? null, platformId: external };
  }
  const phone = input.phone?.trim();
  if (phone) return { platform: input.sourceChannel ?? "whatsapp", platformId: phone };
  return { platform: input.sourceChannel ?? null, platformId: null };
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

export interface LeadExportRow {
  contactId: string | null;
  contactName: string | null;
  platform: string | null;
  platformId: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  source: string | null;
  intent: string | null;
  score: number | null;
  budgetEstimate: number | null;
  notes: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
}

/**
 * Protège contre l'injection de formule (CSV injection) : un nom de prospect
 * saisi par un tiers (« =HYPERLINK(...) ») serait exécuté à l'ouverture dans
 * Excel/Sheets. Toute cellule texte commençant par = + - @ (ou tab/retour
 * chariot) est préfixée d'une apostrophe.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  "Référence",
  "Nom",
  "Plateforme",
  "Identifiant plateforme / numéro",
  "Téléphone",
  "Email",
  "Statut",
  "Source",
  "Intention",
  "Score d'engagement",
  "Budget estimé",
  "Notes",
  "Dernier contact",
  "Prochaine relance",
  "Créé le",
];

/**
 * Séparateur `;` + BOM UTF-8 : c'est ce qu'Excel en locale française ouvre
 * correctement en colonnes (avec `,` tout se retrouve dans une seule colonne)
 * et le BOM évite les accents cassés.
 */
export function buildLeadsCsv(rows: LeadExportRow[], statusLabels: Record<string, string> = {}): string {
  const lines = [CSV_HEADER.map(csvCell).join(";")];
  for (const row of rows) {
    lines.push(
      [
        contactReference(row.contactId),
        row.contactName,
        row.platform,
        row.platformId,
        row.phone,
        row.email,
        statusLabels[row.status] ?? row.status,
        row.source,
        row.intent,
        row.score,
        row.budgetEstimate,
        row.notes,
        row.lastContactAt,
        row.nextFollowUpAt,
        row.createdAt,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
