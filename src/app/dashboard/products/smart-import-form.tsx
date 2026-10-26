"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Miroir minimal du rapport renvoyé par POST /api/catalog/import (mode smart / smart_preview). */
interface Report {
  dryRun: boolean;
  summary: string;
  totalRows: number;
  created: number;
  createdProductIds: string[];
  stockUnknown: number;
  needsClarification: { row: number; name: string; reasons: string[] }[];
  duplicates: { row: number; name: string; reason: "sku" | "name"; scope: "file" | "catalog" }[];
  failed: { row: number; name: string; error: string }[];
  mapping: { fields: Record<string, string>; unmapped: string[] };
  warnings: string[];
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nom", price: "Prix de vente", cost_price: "Prix d'achat", category: "Catégorie", description: "Description",
  stock: "Stock", sku: "Référence", image_urls: "Photos", status: "Statut", specifications: "Caractéristiques",
};
const MAX_SHOWN = 50;
const card = "flex flex-col gap-3 rounded-2xl border border-navy-900/[0.06] bg-white p-4 shadow-[0_1px_2px_rgba(16,23,49,0.04)]";

export function SmartImportForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"idle" | "busy" | "preview" | "imported" | "validated">("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(mode: "smart_preview" | "smart") {
    if (!file) return;
    setStep("busy");
    setError(null);
    const formData = new FormData();
    formData.append("organizationId", organizationId);
    formData.append("file", file);
    formData.append("mode", mode);
    try {
      const res = await fetch("/api/catalog/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur inconnue");
      setReport(data as Report);
      setStep(mode === "smart_preview" ? "preview" : "imported");
      if (mode === "smart") router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
      setStep(report ? (step === "imported" ? "imported" : "preview") : "idle");
    }
  }

  async function validateDrafts() {
    if (!report || report.createdProductIds.length === 0) return;
    setStep("busy");
    setError(null);
    try {
      const res = await fetch("/api/catalog/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, productIds: report.createdProductIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur inconnue");
      setMessage(`${data.activated} produit(s) validé(s) et visibles dans votre boutique${data.skipped > 0 ? `, ${data.skipped} laissé(s) en brouillon (prix à 0)` : ""}.`);
      setStep("validated");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
      setStep("imported");
    }
  }

  const busy = step === "busy";
  const mappedStatus = report?.mapping.fields.status;

  return (
    <section className={card}>
      <div>
        <p className="text-sm font-medium">Import intelligent</p>
        <p className="text-xs text-slate-500">
          Déposez votre fichier tel quel (Excel .xlsx ou CSV, colonnes dans n&apos;importe quel ordre ; seule la première feuille contenant des données est lue). Rien n&apos;est créé avant votre accord, et
          tout arrive en <strong>brouillon</strong>. Aucun prix ni stock n&apos;est inventé.
        </p>
      </div>

      {(step === "idle" || step === "busy" || step === "preview") && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="text-sm"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setStep("idle"); setError(null); }}
          />
          <button type="button" disabled={!file || busy} onClick={() => send("smart_preview")} className="rounded-xl bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Analyse…" : "Analyser le fichier"}
          </button>
        </div>
      )}

      {report && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium text-violet-700">{report.summary}</p>

          <div>
            <p className="text-xs font-semibold text-slate-600">Colonnes reconnues</p>
            <ul className="mt-1 grid gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
              {Object.entries(report.mapping.fields).map(([field, header]) => (
                <li key={field}>« {header} » → <strong>{FIELD_LABELS[field] ?? field}</strong></li>
              ))}
            </ul>
            {mappedStatus && <p className="mt-1 text-xs text-amber-800">La colonne « {mappedStatus} » est ignorée : tout est créé en brouillon.</p>}
            {report.mapping.unmapped.length > 0 && <p className="mt-1 text-xs text-slate-500">Colonnes non utilisées : {report.mapping.unmapped.join(", ")}.</p>}
          </div>

          {report.warnings.length > 0 && (
            <ul className="list-disc rounded-xl bg-amber-50 p-3 pl-6 text-xs text-amber-900">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}

          {report.needsClarification.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600">À préciser dans votre fichier ({report.needsClarification.length}) — non importés</p>
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                {report.needsClarification.slice(0, MAX_SHOWN).map((n) => <li key={n.row}>Ligne {n.row} ({n.name}) : {n.reasons.join(", ")}</li>)}
                {report.needsClarification.length > MAX_SHOWN && <li>… et {report.needsClarification.length - MAX_SHOWN} autres.</li>}
              </ul>
            </div>
          )}

          {report.duplicates.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600">Doublons ignorés ({report.duplicates.length})</p>
              <ul className="mt-1 max-h-32 overflow-y-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                {report.duplicates.slice(0, MAX_SHOWN).map((d) => (
                  <li key={d.row}>Ligne {d.row} ({d.name}) : {d.reason === "sku" ? "même référence" : "même nom"} {d.scope === "catalog" ? "qu'un produit déjà dans votre catalogue" : "qu'une autre ligne du fichier"}</li>
                ))}
              </ul>
            </div>
          )}

          {report.failed.length > 0 && (
            <ul className="max-h-32 overflow-y-auto rounded-xl bg-danger-50 p-3 text-xs text-danger-700">
              {report.failed.map((f) => <li key={f.row}>Ligne {f.row} ({f.name}) : {f.error}</li>)}
            </ul>
          )}

          {report.stockUnknown > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              {report.stockUnknown} produit(s) sans stock renseigné : leur stock est à 0. Une fois validés, ils apparaîtront en <strong>rupture de stock</strong> tant que vous n&apos;aurez pas indiqué leur stock.
            </p>
          )}

          {step === "preview" && report.created > 0 && (
            <button type="button" disabled={busy} onClick={() => send("smart")} className="w-fit rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Importer {report.created} produit(s) en brouillon
            </button>
          )}
          {step === "preview" && report.created === 0 && <p className="text-xs text-slate-500">Aucun produit importable pour l&apos;instant : corrigez le fichier puis relancez l&apos;analyse.</p>}

          {step === "imported" && report.createdProductIds.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-600">Vérifiez vos brouillons dans la liste ci-dessus, puis validez-les d&apos;un geste pour les rendre visibles.</p>
              <button type="button" disabled={busy} onClick={validateDrafts} className="w-fit rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "Validation…" : `Valider ${report.createdProductIds.length} brouillon(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      {step === "validated" && message && <p className="text-sm text-violet-700">{message}</p>}
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </section>
  );
}
