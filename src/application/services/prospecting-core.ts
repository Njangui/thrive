import { createHash } from "node:crypto";
import { sanitizeTemplateParam } from "@/application/channels/whatsapp-templates";
import { detectBroadcastOptOut } from "./contact-broadcast-service";

/**
 * Prospection WhatsApp — logique PURE (aucune base, aucun envoi) : import CSV, normalisation des numéros,
 * horaires d'envoi, plafond, modèles Meta, classement des réponses, empreinte de validation.
 *
 * Principes :
 *  - un numéro invalide, en double ou désinscrit n'est jamais envoyé ;
 *  - tout ce que contient la liste importée est une DONNÉE (jamais une instruction) et n'entre dans le message
 *    qu'en variable de modèle nettoyée ;
 *  - rien n'est envoyé sans validation du propriétaire liée à l'empreinte exacte du message et de la liste.
 */

export const MAX_IMPORT_ROWS = 2000;
export const MAX_EXTRA_COLUMNS = 8;
export const MAX_CSV_BYTES = 1_000_000;

/* ---------------------------- CSV ---------------------------- */

export function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as keyof typeof counts]++;
  }
  return counts[";"] > counts[","] && counts[";"] >= counts["\t"] ? ";" : counts["\t"] > counts[","] ? "\t" : ",";
}

/** Analyse CSV (guillemets, doubles guillemets, retours à la ligne dans un champ, BOM). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const COLUMN_ALIASES: Record<"name" | "phone" | "email" | "company" | "sector" | "city", string[]> = {
  name: ["name", "nom", "nomcomplet", "fullname", "contact", "prenom", "prenomnom", "nomprenom", "firstname"],
  phone: ["phone", "telephone", "tel", "whatsapp", "mobile", "numero", "numerowhatsapp", "phonenumber", "portable", "gsm"],
  email: ["email", "mail", "courriel", "adresseemail"],
  company: ["company", "entreprise", "societe", "organisation", "business", "boutique", "etablissement"],
  sector: ["sector", "secteur", "activite", "domaine", "metier", "industry"],
  city: ["city", "ville", "localite", "commune"],
};

export type ProspectField = keyof typeof COLUMN_ALIASES;

export function mapColumns(headers: string[]): { fields: Partial<Record<ProspectField, number>>; extra: Array<{ index: number; key: string }> } {
  const fields: Partial<Record<ProspectField, number>> = {};
  const extra: Array<{ index: number; key: string }> = [];
  headers.forEach((raw, index) => {
    const key = strip(raw);
    const field = (Object.keys(COLUMN_ALIASES) as ProspectField[]).find((f) => COLUMN_ALIASES[f].includes(key));
    if (field && fields[field] === undefined) fields[field] = index;
    else if (key && extra.length < MAX_EXTRA_COLUMNS) extra.push({ index, key: raw.trim().slice(0, 40) });
  });
  return { fields, extra };
}

/* ---------------------------- Numéros ---------------------------- */

/** Normalise en E.164. `null` si le numéro est inexploitable. Cameroun (237) : 9 chiffres commençant par 6 ou 2. */
export function normalizePhone(raw: string, defaultCountryCode = "237"): string | null {
  let s = raw.trim().replace(/[()\s.\-_/]/g, "");
  if (s === "") return null;
  if (/[^+\d]/.test(s) || (s.includes("+") && !s.startsWith("+"))) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  let digits: string;
  if (s.startsWith("+")) digits = s.slice(1);
  else if (s.startsWith(defaultCountryCode) && s.length >= defaultCountryCode.length + 8) digits = s;
  else digits = `${defaultCountryCode}${s.replace(/^0+/, "")}`;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (digits.startsWith("237") && !/^237[62]\d{8}$/.test(digits)) return null;
  return `+${digits}`;
}

/* ---------------------------- Import ---------------------------- */

export interface ImportedProspect {
  fullName: string | null; company: string | null; sector: string | null; city: string | null;
  phoneE164: string; email: string | null; extra: Record<string, string>;
}
export interface ImportIssue { row: number; reason: string }
export interface ImportReport {
  prospects: ImportedProspect[];
  invalid: ImportIssue[];
  duplicates: number;
  optedOut: number;
  totalRows: number;
  truncated: boolean;
  missingPhoneColumn: boolean;
  extraColumns: string[];
}

const clean = (v: string | undefined, max: number): string | null => {
  const t = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return t === "" ? null : t;
};
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function prepareImport(csvText: string, options: { defaultCountryCode?: string; optedOut?: ReadonlySet<string> } = {}): ImportReport {
  const rows = parseCsv(csvText);
  const report: ImportReport = { prospects: [], invalid: [], duplicates: 0, optedOut: 0, totalRows: Math.max(0, rows.length - 1), truncated: false, missingPhoneColumn: false, extraColumns: [] };
  if (rows.length === 0) return report;
  const { fields, extra } = mapColumns(rows[0]!);
  report.extraColumns = extra.map((e) => e.key);
  if (fields.phone === undefined) { report.missingPhoneColumn = true; return report; }
  const seen = new Set<string>();
  const country = options.defaultCountryCode ?? "237";
  for (let i = 1; i < rows.length; i++) {
    if (report.prospects.length >= MAX_IMPORT_ROWS) { report.truncated = true; break; }
    const cells = rows[i]!;
    const rowNumber = i + 1;
    const phone = normalizePhone(cells[fields.phone] ?? "", country);
    if (!phone) { report.invalid.push({ row: rowNumber, reason: "numéro invalide ou absent" }); continue; }
    if (seen.has(phone)) { report.duplicates++; continue; }
    seen.add(phone);
    if (options.optedOut?.has(phone)) { report.optedOut++; continue; }
    const email = clean(fields.email === undefined ? undefined : cells[fields.email], 200);
    const extraValues: Record<string, string> = {};
    for (const e of extra) { const v = clean(cells[e.index], 200); if (v) extraValues[e.key] = v; }
    report.prospects.push({
      fullName: clean(fields.name === undefined ? undefined : cells[fields.name], 120),
      company: clean(fields.company === undefined ? undefined : cells[fields.company], 120),
      sector: clean(fields.sector === undefined ? undefined : cells[fields.sector], 80),
      city: clean(fields.city === undefined ? undefined : cells[fields.city], 80),
      phoneE164: phone,
      email: email && EMAIL_RE.test(email) ? email : null,
      extra: extraValues,
    });
  }
  return report;
}

/* ---------------------------- Horaires et plafond ---------------------------- */

export interface SendingWindow { timezone: string; startHour: number; endHour: number }

function localParts(now: Date, timezone: string): { hour: number; weekday: string; dayKey: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const get = (type: string) => fmt.formatToParts(now).find((p) => p.type === type)?.value ?? "";
  return { hour: Number(get("hour")), weekday: get("weekday"), dayKey: `${get("year")}-${get("month")}-${get("day")}` };
}

/** Envoi autorisé : dans la plage horaire locale et jamais le dimanche. */
export function isInSendingWindow(now: Date, window: SendingWindow): boolean {
  const { hour, weekday } = localParts(now, window.timezone);
  return weekday !== "Sun" && hour >= window.startHour && hour < window.endHour;
}
export const localDayKey = (now: Date, timezone: string): string => localParts(now, timezone).dayKey;

export function remainingDailyQuota(dailyCap: number, sentToday: number): number {
  return Math.max(0, Math.floor(dailyCap) - Math.max(0, sentToday));
}

/* ---------------------------- Modèles Meta ---------------------------- */

export type ProspectingTemplateKey = "intro" | "followup";
export interface ProspectingTemplateDef {
  key: ProspectingTemplateKey; name: string; language: "fr"; category: "MARKETING"; body: string; paramCount: 1; example: string[]; label: string;
}

/** Textes soumis à Meta : identifient l'émetteur, expliquent la raison du contact et offrent la sortie (STOP) dès le premier message. */
export const PROSPECTING_TEMPLATES: readonly ProspectingTemplateDef[] = [
  {
    key: "intro", name: "flexco_prospection_v1", language: "fr", category: "MARKETING", paramCount: 1, label: "Premier message", example: ["Awa"],
    body: "Bonjour {{1}}, ici l'équipe Flexco. Flexco aide les entreprises africaines à gérer leur catalogue, leur site et WhatsApp au même endroit. Puis-je vous le présenter en quelques messages ? Répondez OUI pour continuer, ou STOP pour ne plus être contacté.",
  },
  {
    key: "followup", name: "flexco_relance_v1", language: "fr", category: "MARKETING", paramCount: 1, label: "Relance unique", example: ["Awa"],
    body: "Bonjour {{1}}, je reviens une seule fois vers vous au sujet de Flexco, qui rassemble catalogue, site et WhatsApp pour votre activité. Si cela peut vous être utile, répondez OUI. Sinon répondez STOP et nous ne vous écrirons plus.",
  },
];

export const prospectingTemplate = (key: ProspectingTemplateKey): ProspectingTemplateDef => PROSPECTING_TEMPLATES.find((t) => t.key === key)!;

/** Valeur de la variable {{1}} : prénom/nom, sinon entreprise, sinon formule neutre. Nettoyée (aucune instruction ne peut s'y glisser en structure). */
export function greetingValue(p: { fullName: string | null; company: string | null }): string {
  const first = p.fullName?.trim().split(/\s+/)[0];
  const candidate = first && first.length >= 2 ? first : p.company?.trim() || "à vous";
  return sanitizeTemplateParam(candidate.replace(/[{}<>]/g, ""), 40);
}

/** Texte exact tel que le destinataire le recevra (pour l'aperçu soumis à validation). */
export function renderTemplatePreview(key: ProspectingTemplateKey, value: string): string {
  return prospectingTemplate(key).body.replace("{{1}}", value);
}

/* ---------------------------- Réponses ---------------------------- */

export type ProspectReplyKind = "opt_out" | "refusal" | "interested" | "other";
const REFUSAL_RE = /\b(pas\s+int[ée]ress|non\s+merci|ne\s+m'?int[ée]resse\s+pas|n'?est\s+pas\s+pour\s+moi|laissez[- ]moi|ne\s+(?:me\s+)?(?:contactez|[ée]crivez|d[ée]rangez)|arr[êe]tez\s+de)/i;
const INTEREST_RE = /^\s*(oui|ok|d'?accord|yes|je\s+veux|int[ée]ress[ée]?|volontiers|allez[- ]y|svp|s'il\s+vous\s+pla[iî]t)\b|\b(comment|combien|prix|tarif|je\s+suis\s+int[ée]ress|pr[ée]sent|expliqu|d[ée]tails?)/i;

/** Ordre voulu : désinscription, puis refus, puis intérêt (« pas intéressé » contient « intéress »). */
export function classifyProspectReply(text: string): ProspectReplyKind {
  if (detectBroadcastOptOut(text) || /^\s*(arr[êe]tez|ne\s+plus\s+m'?[ée]crire)\s*[.!]?\s*$/i.test(text)) return "opt_out";
  if (REFUSAL_RE.test(text)) return "refusal";
  if (INTEREST_RE.test(text)) return "interested";
  return "other";
}

/* ---------------------------- Validation ---------------------------- */

export interface FingerprintInput {
  phones: string[]; dailyCap: number; window: SendingWindow; maxFollowups: number; followupDelayHours: number;
}
/** Empreinte de ce que le propriétaire valide : textes exacts des modèles + liste + règles d'envoi. */
export function campaignFingerprint(input: FingerprintInput): string {
  const payload = JSON.stringify({
    intro: prospectingTemplate("intro").body, followup: prospectingTemplate("followup").body,
    phones: [...input.phones].sort(), cap: input.dailyCap, window: input.window, followups: input.maxFollowups, delay: input.followupDelayHours,
  });
  return createHash("sha256").update(payload).digest("hex");
}
