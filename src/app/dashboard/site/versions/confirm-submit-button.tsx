"use client";

/** Bouton d'envoi avec confirmation du navigateur (même principe que ResetSiteButton). */
export function ConfirmSubmitButton({
  message,
  children,
  className = "adm-btn-secondary",
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
