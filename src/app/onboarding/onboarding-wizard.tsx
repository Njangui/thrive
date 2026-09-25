"use client";

import { FlexcoBrand } from "@/app/_components/flexco-brand";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBusinessStep, submitLogoStep, submitContactStep, submitProductStep, submitFaqStep, advanceOnboardingStep, completeOnboarding } from "./onboarding-actions";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import type { PublicCountry } from "@/application/services/country-service";

const TOTAL_STEPS = 6;
const DEFAULT_COUNTRY_FALLBACK = "CM";
const INDUSTRY_OPTIONS = [
  { value: "retail", label: "Commerce / Boutique", icon: "▦", desc: "Produits, ventes et stock" },
  { value: "restaurant", label: "Restauration", icon: "◈", desc: "Menu, commandes et disponibilité" },
  { value: "beauty", label: "Beauté & bien-être", icon: "✦", desc: "Prestations et rendez-vous" },
  { value: "professional_services", label: "Services professionnels", icon: "⌁", desc: "Services, clients et rendez-vous" },
  { value: "real_estate", label: "Immobilier", icon: "⌂", desc: "Biens, demandes et prospects" },
  { value: "", label: "Autre activité", icon: "＋", desc: "Configuration générale" },
];
const SUGGESTED_FAQS = [
  { question: "Quels sont vos horaires d'ouverture ?" },
  { question: "Comment puis-je vous joindre ?" },
  { question: "Livrez-vous ?" },
];

function StepHeader({ step, title, description }: { step: number; title: string; description?: string }) {
  return <div className="onb-header"><div className="onb-progress">{Array.from({ length: TOTAL_STEPS }, (_, i) => <span key={i} className={i < step ? "is-active" : ""} />)}</div><div className="onb-step-meta"><span>Étape {step} sur {TOTAL_STEPS}</span><span>{Math.round((step / TOTAL_STEPS) * 100)}%</span></div><h1>{title}</h1>{description && <p>{description}</p>}</div>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="onb-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function OnboardingWizard({ countries = [], initialStep = 1, initialOrganizationId = null }: { countries?: PublicCountry[]; initialStep?: number; initialOrganizationId?: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [organizationId, setOrganizationId] = useState<string | null>(initialOrganizationId);
  const [industry, setIndustry] = useState("");
  const [selectedCountryCode, setSelectedCountryCode] = useState(() => countries.find(c => c.isoCode === DEFAULT_COUNTRY_FALLBACK)?.isoCode ?? countries[0]?.isoCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isResuming] = useState(initialStep > 1);
  const selectedCountry = countries.find(c => c.isoCode === selectedCountryCode);

  useEffect(() => { if (step === 6 && organizationId) void completeOnboarding(organizationId); }, [step, organizationId]);

  function onForm(handler: (formData: FormData) => void) { return (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); handler(new FormData(event.currentTarget)); }; }
  function businessSubmit(formData: FormData) { setError(null); startTransition(async () => { const result = await submitBusinessStep(String(formData.get("name") ?? ""), String(formData.get("industry") ?? industry), String(formData.get("countryCode") ?? selectedCountryCode), String(formData.get("promoCode") ?? "")); if (!result.ok || !result.organizationId) return setError(result.error ?? "Impossible de créer votre entreprise."); setOrganizationId(result.organizationId); setStep(2); }); }
  function optionalSubmit(action: (organizationId: string, formData: FormData) => Promise<{ ok: boolean; error?: string }>) { return (formData: FormData) => { if (!organizationId) return; setError(null); startTransition(async () => { const result = await action(organizationId, formData); if (!result.ok) return setError(result.error ?? "Une erreur est survenue."); setStep(s => s + 1); }); }; }
  function skip() { setError(null); setStep(s => { const next = s + 1; if (organizationId) void advanceOnboardingStep(organizationId, next); return next; }); }

  return <main className="onboarding-page"><div className="onb-topbar"><FlexcoBrand compact dark /><span className="onb-save">Configuration sauvegardée automatiquement</span></div><div className="onb-layout"><aside className="onb-side"><span className="auth-kicker">Bienvenue</span><h2>Construisons votre espace.</h2><p>Quelques étapes suffisent pour adapter Flexco à votre activité. Vous pourrez tout modifier plus tard.</p><div className="onb-side-list">{["Votre activité", "Votre identité", "Vos coordonnées", "Votre catalogue", "Vos réponses", "Prêt à démarrer"].map((x, i) => <div key={x} className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}><span>{step > i + 1 ? "✓" : i + 1}</span>{x}</div>)}</div></aside><section className="onb-card">{isResuming && !error && <div className="onb-resume">↻ Vous reprenez une configuration déjà commencée.</div>}{error && <p className="adm-alert-danger">{error}</p>}

{step === 1 && <><StepHeader step={1} title="Parlons de votre entreprise" description="Choisissez votre secteur : Flexco adaptera automatiquement votre tableau de bord et vos outils."/><form onSubmit={onForm(businessSubmit)} className="onb-form"><Field label="Nom de l’entreprise"><input name="name" required autoFocus className="adm-input" placeholder="Ex. Kamenur Shop" /></Field><Field label="Pays"><select name="countryCode" value={selectedCountryCode} onChange={e => setSelectedCountryCode(e.target.value)} required className="adm-input">{countries.length ? countries.map(c => <option key={c.isoCode} value={c.isoCode}>{c.name} · {c.currencyCode}</option>) : <option value="">Aucun pays disponible</option>}</select></Field><div className="onb-label-row"><span>Votre activité</span><small>Cette sélection pilote votre interface</small></div><div className="industry-grid">{INDUSTRY_OPTIONS.map(opt => <button type="button" key={opt.value} onClick={() => setIndustry(opt.value)} className={`industry-option ${industry === opt.value ? "selected" : ""}`}><span className="industry-icon">{opt.icon}</span><span><b>{opt.label}</b><small>{opt.desc}</small></span>{industry === opt.value && <i>✓</i>}</button>)}</div><input type="hidden" name="industry" value={industry} /><Field label="Code promo (optionnel)"><input name="promoCode" className="adm-input" placeholder="Ex. MARIE10" /></Field><button disabled={isPending || !countries.length} className="adm-btn-primary onb-submit">{isPending ? "Création..." : "Continuer"}<span>→</span></button></form></>}

{step === 2 && <><StepHeader step={2} title="Donnez une identité à votre entreprise" description="Ajoutez votre logo maintenant ou faites-le plus tard."/><form onSubmit={onForm(optionalSubmit(submitLogoStep))} className="onb-form"><div className="onb-upload-card"><span className="onb-upload-icon">✦</span><div><b>Logo de votre entreprise</b><p>PNG, JPG ou WEBP. Vous pourrez le remplacer à tout moment.</p></div></div><ImageUploadField name="logo" label="Logo" /><div className="onb-actions"><button type="submit" disabled={isPending} className="adm-btn-primary">{isPending ? "Enregistrement..." : "Continuer"} →</button><button type="button" onClick={skip} className="adm-btn-secondary">Passer pour l’instant</button></div></form></>}

{step === 3 && <><StepHeader step={3} title="Comment vos clients peuvent-ils vous joindre ?" description="Ces informations alimenteront votre vitrine publique."/><form onSubmit={onForm(optionalSubmit(submitContactStep))} className="onb-form"><div className="onb-two-col"><Field label="Téléphone"><input name="phone" inputMode="tel" placeholder={`${selectedCountry?.phoneCode ?? "+237"} 6XX XXX XXX`} className="adm-input" /></Field><Field label="WhatsApp"><input name="whatsapp" inputMode="tel" placeholder={`${selectedCountry?.phoneCode ?? "+237"} 6XX XXX XXX`} className="adm-input" /></Field></div><Field label="Adresse"><input name="address" className="adm-input" placeholder="Quartier, ville, repère..." /></Field><div className="onb-actions"><button type="submit" disabled={isPending} className="adm-btn-primary">{isPending ? "Enregistrement..." : "Continuer"} →</button><button type="button" onClick={skip} className="adm-btn-secondary">Passer pour l’instant</button></div></form></>}

{step === 4 && <><StepHeader step={4} title={industry === "restaurant" ? "Ajoutez votre premier plat" : industry === "beauty" || industry === "professional_services" ? "Ajoutez votre première prestation" : industry === "real_estate" ? "Ajoutez votre premier bien" : "Ajoutez votre premier produit"} description="Un premier élément suffit. Vous pourrez enrichir votre catalogue ensuite."/><form onSubmit={onForm(optionalSubmit(submitProductStep))} className="onb-form"><Field label={industry === "restaurant" ? "Nom du plat" : industry === "real_estate" ? "Nom du bien" : industry === "beauty" || industry === "professional_services" ? "Nom de la prestation" : "Nom du produit"}><input name="name" className="adm-input" placeholder="Ex. Article, service, plat..." /></Field><div className="onb-two-col"><Field label="Prix (FCFA)"><input name="price" type="number" min="0" defaultValue={0} className="adm-input" /></Field><Field label="Stock"><input name="stock" type="number" min="0" defaultValue={0} className="adm-input" /></Field></div><ImageUploadField name="image" label="Photo" helpText="Optionnel." /><div className="onb-actions"><button type="submit" disabled={isPending} className="adm-btn-primary">{isPending ? "Enregistrement..." : "Continuer"} →</button><button type="button" onClick={skip} className="adm-btn-secondary">Passer pour l’instant</button></div></form></>}

{step === 5 && <><StepHeader step={5} title="Répondez aux questions que vos clients posent souvent" description="Ces réponses pourront être utilisées dans votre FAQ et par l’assistant."/><form onSubmit={onForm(optionalSubmit(submitFaqStep))} className="onb-form">{SUGGESTED_FAQS.map((faq, i) => <div key={faq.question} className="faq-onb-item"><input type="hidden" name={`question${i}`} value={faq.question} /><label>{faq.question}</label><input name={`answer${i}`} className="adm-input" placeholder="Votre réponse (optionnel)" /></div>)}<div className="onb-actions"><button type="submit" disabled={isPending} className="adm-btn-primary">{isPending ? "Enregistrement..." : "Terminer"} ✓</button><button type="button" onClick={skip} className="adm-btn-secondary">Passer pour l’instant</button></div></form></>}

{step === 6 && <div className="onb-complete"><div className="onb-complete-icon">✓</div><StepHeader step={6} title="Votre espace est prêt" description="Votre tableau de bord a été adapté à votre activité. Vous pourrez compléter votre configuration quand vous le souhaitez."/><button onClick={() => router.push("/dashboard")} className="adm-btn-primary onb-submit">Ouvrir mon tableau de bord <span>→</span></button></div>}
</section></div></main>;
}
