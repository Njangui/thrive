import Link from "next/link";
import type { ReactNode } from "react";
import { CresyvaBrand } from "./cresyva-brand";

function MiniBarChart() {
  const bars = [34, 48, 42, 64, 56, 76, 62, 84, 72];
  return (
    <div className="auth-mini-chart" aria-hidden>
      {bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
    </div>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  mode = "login",
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  mode?: "login" | "signup" | "reset";
}) {
  const copy = mode === "signup"
    ? { kicker: "Lancez votre activité", title: "Votre entreprise, enfin organisée.", body: "Catalogue, clients, commandes et visibilité réunis dans un espace simple." }
    : mode === "reset"
      ? { kicker: "Accès sécurisé", title: "Reprenez le contrôle de votre compte.", body: "Votre espace reste protégé. Choisissez un nouveau mot de passe et continuez votre activité." }
      : { kicker: "Bienvenue sur CRESYVA", title: "Pilotez votre entreprise avec plus de clarté.", body: "Un espace unique pour vendre, suivre vos clients et développer votre activité." };

  return (
    <main className="auth-page">
      <div className="auth-bg-orb auth-bg-orb-one" />
      <div className="auth-bg-orb auth-bg-orb-two" />
      <div className="auth-layout">
        <section className="auth-brand-panel">
          <CresyvaBrand href="/" dark />
          <div className="auth-brand-copy">
            <span className="auth-kicker">{copy.kicker}</span>
            <h2>{copy.title}</h2>
            <p>{copy.body}</p>
            <div className="auth-preview-window">
              <div className="auth-preview-topbar"><span /><span /><span /><b>Tableau de bord</b></div>
              <div className="auth-preview-body">
                <div className="auth-preview-sidebar">
                  <i /><i /><i /><i /><i />
                </div>
                <div className="auth-preview-main">
                  <div className="auth-preview-heading"><div><small>Vue d’ensemble</small><strong>Bonjour 👋</strong></div><em>30 jours</em></div>
                  <div className="auth-preview-stats"><span><small>Ventes</small><b>1 245 000</b></span><span><small>Commandes</small><b>48</b></span><span><small>Clients</small><b>32</b></span></div>
                  <div className="auth-preview-chart"><small>Évolution des ventes</small><MiniBarChart /></div>
                </div>
              </div>
            </div>
            <div className="auth-trust-row"><span>✓ Configuration simple</span><span>✓ Données séparées</span><span>✓ Accessible sur mobile</span></div>
          </div>
        </section>

        <section className="auth-form-panel">
          <div className="auth-mobile-logo"><CresyvaBrand compact dark /></div>
          <div className="auth-form-card">
            <span className="auth-form-badge">{mode === "reset" ? "Mot de passe" : mode === "signup" ? "Créer un compte" : "Connexion"}</span>
            <h1>{title}</h1>
            <p className="auth-form-subtitle">{subtitle}</p>
            {children}
          </div>
          <p className="auth-footer">© {new Date().getFullYear()} CRESYVA · Une solution pensée pour les PME africaines.</p>
        </section>
      </div>
    </main>
  );
}
