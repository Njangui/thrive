import { switchOrganizationAction } from "../org-actions";

/**
 * Sélecteur d'entreprise — affiché UNIQUEMENT si l'utilisateur est membre de
 * plusieurs entreprises. Formulaire HTML simple (aucun JavaScript client).
 */
export function OrgSwitcher({ orgs, currentId }: { orgs: { organizationId: string; organizationName: string }[]; currentId: string }) {
  if (orgs.length < 2) return null;
  return (
    <form action={switchOrganizationAction} className="flex flex-wrap items-center gap-2 border-b border-navy-900/[0.06] bg-white px-4 py-2 text-sm sm:px-6">
      <label htmlFor="org-switch" className="text-slate-500">Entreprise</label>
      <select id="org-switch" name="organizationId" defaultValue={currentId} className="rounded-lg border border-navy-900/[0.09] bg-white px-2 py-1 text-sm">
        {orgs.map((o) => (
          <option key={o.organizationId} value={o.organizationId}>{o.organizationName || o.organizationId.slice(0, 8)}</option>
        ))}
      </select>
      <button type="submit" className="rounded-lg bg-violet-600 px-3 py-1 text-sm font-medium text-white">Changer</button>
    </form>
  );
}
