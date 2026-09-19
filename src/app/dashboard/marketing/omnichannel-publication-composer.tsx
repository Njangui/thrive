"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { CatalogProductSummary } from "@/application/services/catalog-service";
import type { PublicationTarget } from "@/application/services/omnichannel-publication-service";

export function OmnichannelPublicationComposer({
  action,
  products,
  targets,
}: {
  action: (formData: FormData) => void | Promise<void>;
  products: CatalogProductSummary[];
  targets: PublicationTarget[];
}) {
  const [selectedProducts, setSelectedProducts] = useState<string[]>(products.slice(0, 1).map((p) => p.id));
  const [selectedTargets, setSelectedTargets] = useState<string[]>(targets.filter((t) => t.available && t.type !== "telegram").map((t) => t.id));
  const [caption, setCaption] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [datetime, setDatetime] = useState("");
  const [telegramManualChatId, setTelegramManualChatId] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");

  const grouped = useMemo(() => ({
    social: targets.filter((t) => t.type === "social"),
    telegram: targets.filter((t) => t.type === "telegram"),
    whatsapp: targets.filter((t) => t.type === "whatsapp_group"),
  }), [targets]);

  const toggle = (value: string, setter: Dispatch<SetStateAction<string[]>>) => setter((current) => current.includes(value) ? current.filter((id) => id !== value) : [...current, value]);
  const allCompatible = selectedTargets.length + (telegramManualChatId.trim() ? 1 : 0) > 0;

  return (
    <form action={action} onSubmit={(event) => {
      if (!selectedProducts.length || !allCompatible || (schedule && !datetime)) { event.preventDefault(); return; }
      const form = event.currentTarget;
      const productsInput = form.elements.namedItem("productIds") as HTMLInputElement;
      const targetsInput = form.elements.namedItem("targetIds") as HTMLInputElement;
      const scheduledInput = form.elements.namedItem("scheduledFor") as HTMLInputElement;
      const mediaUrlInput = form.elements.namedItem("mediaUrl") as HTMLInputElement;
      const mediaTypeInput = form.elements.namedItem("mediaType") as HTMLInputElement;
      productsInput.value = selectedProducts.join(",");
      targetsInput.value = selectedTargets.join(",");
      scheduledInput.value = schedule && datetime ? new Date(datetime).toISOString() : "";
      mediaUrlInput.value = mediaUrl.trim();
      mediaTypeInput.value = mediaType;
    }} className="space-y-7">
      <input type="hidden" name="productIds" />
      <input type="hidden" name="targetIds" />
      <input type="hidden" name="scheduledFor" />
      <input type="hidden" name="telegramManualChatId" value={telegramManualChatId} />
      <input type="hidden" name="mediaUrl" />
      <input type="hidden" name="mediaType" />

      <section>
        <div className="flex items-end justify-between gap-3">
          <div><p className="cresyva-eyebrow">1 · Catalogue</p><h2 className="mt-1 font-jakarta text-lg font-extrabold text-navy-900">Choisissez ce que vous voulez publier</h2><p className="mt-1 text-sm text-slate-500">Le nom, prix, description, catégorie, image et lien produit sont repris automatiquement.</p></div>
          <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary-700">{selectedProducts.length} sélectionné{selectedProducts.length > 1 ? "s" : ""}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const checked = selectedProducts.includes(product.id);
            return <button type="button" key={product.id} onClick={() => toggle(product.id, setSelectedProducts)} className={`text-left rounded-2xl border p-3 transition ${checked ? "border-primary bg-primary-50/50 ring-2 ring-primary/15" : "border-slate-200 bg-white hover:border-slate-300"}`}>
              <div className="flex gap-3"><div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : null}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-sm font-bold text-navy-900">{product.name}</p><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${checked ? "border-primary bg-primary text-navy-900" : "border-slate-300 bg-white"}`}>{checked ? "✓" : ""}</span></div><p className="mt-1 text-xs font-semibold text-primary-700">{product.unitPrice.toLocaleString("fr-FR")} FCFA</p>{product.categoryName ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{product.categoryName}</p> : null}</div></div>
            </button>;
          })}
        </div>
      </section>

      <section>
        <p className="cresyva-eyebrow">2 · Message</p>
        <h2 className="mt-1 font-jakarta text-lg font-extrabold text-navy-900">Ajoutez une introduction (optionnel)</h2>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} name="content" rows={4} maxLength={1000} placeholder="Ex. Découvrez nos nouveautés de la semaine…" className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
      </section>

      <section>
        <p className="cresyva-eyebrow">3 · Média optionnel</p>
        <h2 className="mt-1 font-jakarta text-lg font-extrabold text-navy-900">Ajoutez une vidéo ou un visuel externe si nécessaire</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
          <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} type="url" placeholder="https://…" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
          <select value={mediaType} onChange={(e) => setMediaType(e.target.value as "image" | "video")} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"><option value="image">Image</option><option value="video">Vidéo</option></select>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Pour YouTube, fournissez une URL vidéo publique (MP4, MOV, WebM ou M4V). Sans cela, YouTube sera refusé tandis que les autres canaux peuvent continuer.</p>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3"><div><p className="cresyva-eyebrow">4 · Canaux</p><h2 className="mt-1 font-jakarta text-lg font-extrabold text-navy-900">Diffusez depuis un seul endroit</h2><p className="mt-1 text-sm text-slate-500">Chaque canal reçoit le même contenu adapté à ses capacités.</p></div><span className="text-xs font-semibold text-slate-500">{selectedTargets.length + (telegramManualChatId.trim() ? 1 : 0)} cible(s)</span></div>
        <div className="mt-4 space-y-5">
          {([['social', 'Réseaux sociaux', grouped.social], ['telegram', 'Telegram', grouped.telegram], ['whatsapp', 'WhatsApp · groupes', grouped.whatsapp]] as const).map(([type, title, items]) => <div key={type} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold text-navy-900">{title}</p><span className="text-[11px] font-semibold text-slate-400">{items.filter((t) => selectedTargets.includes(t.id)).length} sélectionné(s)</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map((target) => { const checked = selectedTargets.includes(target.id); return <label key={target.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-3 ${!target.available ? "cursor-not-allowed opacity-55" : checked ? "border-primary ring-1 ring-primary/20" : "border-slate-200"}`}><input type="checkbox" disabled={!target.available} checked={checked} onChange={() => toggle(target.id, setSelectedTargets)} className="mt-0.5 h-4 w-4 accent-primary" /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-navy-900">{target.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{target.available ? target.platform : target.reason}</span></span></label>; })}</div>{type === 'telegram' ? <div className="mt-3"><label className="text-xs font-semibold text-slate-600">Autre canal ou groupe Telegram</label><input value={telegramManualChatId} onChange={(e) => setTelegramManualChatId(e.target.value)} placeholder="@moncanal ou -1001234567890" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" /><p className="mt-1 text-[11px] text-slate-500">Le bot doit être présent et autorisé à publier dans ce canal/groupe.</p></div> : null}</div>)}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <label className="flex cursor-pointer items-center justify-between gap-4"><span><span className="block text-sm font-bold text-navy-900">Programmer la publication</span><span className="mt-0.5 block text-xs text-slate-500">Désactivé = diffusion immédiate.</span></span><input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="h-5 w-5 accent-primary" /></label>
        {schedule ? <input type="datetime-local" value={datetime} min={new Date(Date.now() + 2 * 60_000).toISOString().slice(0,16)} onChange={(e) => setDatetime(e.target.value)} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 sm:w-auto" /> : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5"><p className="text-xs text-slate-500">{selectedProducts.length ? "Le contenu est généré depuis votre catalogue." : "Sélectionnez au moins un produit."}</p><div className="flex gap-2"><a href="/dashboard/marketing" className="adm-btn-secondary">Annuler</a><button type="submit" disabled={!selectedProducts.length || !allCompatible || (schedule && !datetime)} className="adm-btn-primary disabled:cursor-not-allowed disabled:opacity-45">{schedule ? "Programmer sur les canaux" : "Publier sur les canaux"}</button></div></div>
    </form>
  );
}
