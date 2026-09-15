"use client";

import { useState } from "react";

export function CsvImportForm({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fileInput = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("organizationId", organizationId);
    formData.append("file", file);

    const res = await fetch("/api/catalog/import", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setStatus("error");
      setErrorMessage(data.error ?? "Erreur inconnue");
      return;
    }

    setStatus("done");
    setResult({ created: data.created, failed: data.failed });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
      <p className="text-sm font-medium">Import en masse (CSV)</p>
      <p className="text-xs text-slate-500">Colonnes : name, price, category, description, stock, status</p>
      <input type="file" name="file" accept=".csv" required className="text-sm" />
      <button
        type="submit"
        disabled={status === "uploading"}
        className="w-fit rounded-xl bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === "uploading" ? "Import en cours..." : "Importer"}
      </button>
      {result && (
        <p className="text-sm text-violet-600">
          {result.created} produit(s) créé(s){result.failed > 0 ? `, ${result.failed} échec(s)` : ""}.
        </p>
      )}
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
