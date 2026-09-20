"use client";

export function ResetSiteButton() {
  return (
    <button
      type="submit"
      onClick={(event) => {
        const confirmed = window.confirm(
          "Revenir au design de base de votre secteur ? Vos données resteront conservées, mais les personnalisations de la vitrine seront réinitialisées.",
        );
        if (!confirmed) event.preventDefault();
      }}
      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100"
    >
      Réinitialiser le design
    </button>
  );
}
