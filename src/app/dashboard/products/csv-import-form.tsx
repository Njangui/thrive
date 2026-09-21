"use client";

import { useState } from "react";

interface ImportRowResult {
  row: number;
  name: string;
  status: "created" | "failed";
  error?: string;
}

interface ImportResult {
  created: number;
  failed: number;
  rows?: ImportRowResult[];
}

// Catalogue V2 (retour commerçant, sept. 2026) — exemple téléchargeable
// pour rendre évidente la syntaxe des nouvelles colonnes (plusieurs
// photos séparées par "|", informations complémentaires au format
// "Libellé:Valeur"), plutôt que de la deviner à partir d'une phrase
// d'aide. Généré côté navigateur : aucun aller-retour serveur nécessaire
// pour un simple fichier statique.
const CSV_TEMPLATE = `name,price,category,description,stock,status,image_urls,specifications
Sneakers Air Max,35000,Chaussures,Confortables et légères,12,active,https://exemple.com/photo1.jpg|https://exemple.com/photo2.jpg,Matière:Cuir|Garantie:6 mois
Jean Slim,18000,Vêtements,Coupe ajustée,0,draft,,
`;

function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modele-import-produits.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function CsvImportForm({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showFailedRows, setShowFailedRows] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fileInput = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setErrorMessage(null);
    setShowFailedRows(false);

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
    setResult({ created: data.created, failed: data.failed, rows: data.rows });
  }

  const failedRows = result?.rows?.filter((r) => r.status === "failed") ?? [];

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
      <p className="text-sm font-medium">Import en masse (CSV)</p>
      <p className="text-xs text-slate-500">
        Colonnes : name, price, category, description, stock, status, image_urls, specifications.
      </p>
      <p className="text-xs text-slate-500">
        <code className="rounded-sm bg-navy-900/5 px-1">image_urls</code> : plusieurs photos séparées par «&nbsp;|&nbsp;»
        (une seule aussi acceptée). <code className="rounded-sm bg-navy-900/5 px-1">specifications</code> : «&nbsp;
        Libellé:Valeur|Libellé2:Valeur2&nbsp;».
      </p>
      <button
        type="button"
        onClick={downloadCsvTemplate}
        className="w-fit text-xs font-medium text-violet-600 hover:underline"
      >
        Télécharger un exemple de fichier CSV
      </button>
      <input type="file" name="file" accept=".csv" required className="text-sm" />
      <button
        type="submit"
        disabled={status === "uploading"}
        className="w-fit rounded-xl bg-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === "uploading" ? "Import en cours..." : "Importer"}
      </button>
      {result && (
        <div className="text-sm">
          <p className="text-violet-600">
            {result.created} produit(s) créé(s){result.failed > 0 ? `, ${result.failed} échec(s)` : ""}.
          </p>
          {failedRows.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowFailedRows((v) => !v)}
                className="mt-1 text-xs font-medium text-danger-600 hover:underline"
              >
                {showFailedRows ? "Masquer le détail des échecs" : "Voir le détail des échecs"}
              </button>
              {showFailedRows && (
                <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl bg-danger-50 p-3 text-xs text-danger-700">
                  {failedRows.map((row) => (
                    <li key={row.row}>
                      Ligne {row.row} ({row.name}) : {row.error ?? "erreur inconnue"}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      {errorMessage && <p className="text-sm text-danger-600">{errorMessage}</p>}
    </form>
  );
}
