import type { ReactNode } from "react";
import type { SVGProps } from "react";
import { tokoo Brand } from "./tokoo -brand";

/** Logo "G" multicolore officiel — utilisé UNIQUEMENT sur le bouton
 * "Continuer avec Google" (login/signup), jamais ailleurs : c'est la
 * seule icône de marque tierce de ces deux pages, distinct du reste du
 * jeu d'icônes trait/`currentColor` de `app-icons.tsx`. */
export function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" {...props}>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9Z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4c-7.7 0-14.4 4.3-17.7 10.7Z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5c3.3 6.5 10 11 17.8 10.9Z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C40.9 36 44 30.9 44 24c0-1.3-.1-2.7-.4-3.9Z" />
    </svg>
  );
}

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
      : { kicker: "Bienvenue sur tokoo ", title: "Pilotez votre entreprise avec plus de clarté.", body: "Un espace unique pour vendre, suivre vos clients et développer votre activité." };

  return (
    <main className="auth-page">
      <div className="auth-bg-orb auth-bg-orb-one" />
      <div className="auth-bg-orb auth-bg-orb-two" />
      <div className="auth-layout">
        <section className="auth-brand-panel">
          <tokoo Brand href="/" dark />
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
          <div className="auth-mobile-logo"><tokoo Brand compact dark /></div>
          <div className="auth-form-card">
            <span className="auth-form-badge">{mode === "reset" ? "Mot de passe" : mode === "signup" ? "Créer un compte" : "Connexion"}</span>
            <h1>{title}</h1>
            <p className="auth-form-subtitle">{subtitle}</p>
            {children}
          </div>
          <p className="auth-footer">© {new Date().getFullYear()} tokoo  · Une solution pensée pour les PME africaines.</p>
        </section>
      </div>
    </main>
  );
}
