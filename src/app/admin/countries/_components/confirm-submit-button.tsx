"use client";

/**
 * Section 20 : "Une désactivation de pays ne doit jamais être faite avec
 * un simple clic sans confirmation [...] Même chose pour réactiver."
 * Composant volontairement minimal (pas de librairie de modale) : un
 * `window.confirm()` suffit à satisfaire l'exigence sans complexité
 * supplémentaire (section 49). `type="submit"` à l'intérieur du `<form
 * action={serverAction}>` parent — `preventDefault()` bloque la
 * soumission si l'utilisateur annule.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  className,
  children,
}: {
  confirmMessage: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
