"use client";

import { useState } from "react";

export function TelegramPublicationComposer({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  const [schedule, setSchedule] = useState(false);
  const [datetime, setDatetime] = useState("");

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (schedule && !datetime) {
          event.preventDefault();
          return;
        }
        const form = event.currentTarget;
        const hidden = form.elements.namedItem("scheduledFor") as HTMLInputElement | null;
        if (hidden) hidden.value = schedule && datetime ? new Date(datetime).toISOString() : "";
      }}
      className="space-y-5"
    >
      <input type="hidden" name="scheduledFor" defaultValue="" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <label className="block">
            <span className="adm-label">Message</span>
            <textarea
              name="content"
              required
              maxLength={4096}
              rows={9}
              placeholder="Écrivez votre publication…"
              className="mt-2 min-h-52 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-navy-900 outline-hidden transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>

          <label className="block">
            <span className="adm-label">Image ou média public (optionnel)</span>
            <input
              name="attachmentUrl"
              type="url"
              placeholder="https://…"
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-hidden focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
            <input type="hidden" name="attachmentType" value="image" />
            <p className="mt-1.5 text-xs text-slate-500">Le média doit être accessible publiquement par Telegram.</p>
          </label>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="adm-eyebrow">Destination</p>
          <h3 className="mt-1 font-jakarta text-base font-bold">Telegram</h3>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Utilisez @nomducanal ou l&apos;identifiant numérique du groupe/canal. Le bot doit avoir le droit d&apos;y publier.
          </p>

          <label className="mt-5 block">
            <span className="adm-label">Chat / canal</span>
            <input
              name="targetChatId"
              required
              placeholder="@ma_boutique ou -1001234567890"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-hidden focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>

          <label className="mt-4 block">
            <span className="adm-label">Nom interne (optionnel)</span>
            <input
              name="targetLabel"
              placeholder="Canal principal"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-hidden focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold">Programmer</span>
                <span className="block text-xs text-slate-500">Sinon, la publication part immédiatement.</span>
              </span>
              <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="h-4 w-4 accent-primary" />
            </label>
            {schedule && (
              <input
                type="datetime-local"
                value={datetime}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(e) => setDatetime(e.target.value)}
                className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-hidden focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            )}
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
        <a href="/dashboard/marketing" className="adm-btn-secondary">Annuler</a>
        <button type="submit" className="adm-btn-primary">
          {schedule ? "Programmer la publication" : "Publier maintenant"}
        </button>
      </div>
    </form>
  );
}
