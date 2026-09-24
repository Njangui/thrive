import type { Metadata } from "next";
import Link from "next/link";
import { tokoo Brand } from "@/app/_components/tokoo -brand";
import { getPlatformSettingNumber } from "@/application/services/platform-settings-service";
import { buildMarketingMetadata } from "@/app/_lib/marketing-page";

export async function generateMetadata(): Promise<Metadata> {
  return buildMarketingMetadata({
    path: "/devenir-affilie",
    title: "Devenir affilié — tokoo ",
    description: "Recommandez tokoo  et gagnez une commission sur les nouveaux abonnements.",
  });
}

export default async function BecomeAffiliatePage() {
  const rate = await getPlatformSettingNumber("affiliate_commission_rate_bps", 2000);
  const percent = (rate / 100).toFixed(0);
  return <main className="affiliate-page"><header className="pricing-nav"><tokoo Brand href="/" /><nav><Link href="/tarifs">Tarifs</Link><Link href="/#fonctionnalites">Fonctionnalités</Link><Link href="/login">Connexion</Link></nav><Link href="/login?next=/affiliate/apply" className="mkt-btn-primary !px-5 !py-2.5">Rejoindre le programme</Link></header><section className="affiliate-hero"><div><span className="mkt-badge-pill">Programme partenaire tokoo </span><h1>Recommandez une solution utile. <span>Gagnez sur chaque conversion.</span></h1><p>Partagez votre lien personnel auprès des commerçants, prestataires et entrepreneurs de votre réseau. Le suivi est automatique et votre commission est calculée selon les règles du programme.</p><div className="affiliate-cta"><Link href="/login?next=/affiliate/apply" className="mkt-btn-primary">Devenir affilié →</Link><Link href="/tarifs" className="mkt-btn-secondary">Voir les offres</Link></div></div><div className="affiliate-visual"><div className="affiliate-visual-card"><div><small>Commission</small><b>{percent}%</b><span>par abonnement validé</span></div><div className="affiliate-ring">↗</div></div><div className="affiliate-mini-grid"><div><small>Clics</small><b>Suivis</b></div><div><small>Conversions</small><b>Attribuées</b></div><div><small>Paiement</small><b>Sur demande</b></div><div><small>Liens</small><b>Campagnes</b></div></div></div></section><section className="affiliate-steps"><div className="affiliate-section-heading"><span className="mkt-eyebrow">Simple et transparent</span><h2>Votre parcours en trois étapes.</h2></div><div className="affiliate-step-grid">{[["01","Candidatez","Un formulaire court permet de présenter votre profil et vos canaux de promotion."],["02","Partagez","Après validation, créez vos liens de suivi et partagez-les dans vos campagnes."],["03","Gagnez","Les conversions éligibles sont attribuées à votre compte et suivent les règles de paiement du programme."]].map(([n,t,d]) => <article key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></article>)}</div></section><section className="affiliate-bottom"><div><span className="mkt-eyebrow">Pensé pour les réseaux locaux</span><h2>Commerçants, agences, créateurs, consultants et communautés.</h2><p>Vous connaissez déjà les personnes que tokoo  peut aider. Votre rôle est de faire la mise en relation ; la plateforme s’occupe du suivi.</p></div><Link href="/login?next=/affiliate/apply" className="mkt-btn-primary">Commencer ma candidature</Link></section></main>;
}
