/**
 * Trois familles de tokens couleur, volontairement séparées :
 *  - `brand-*` : personnalisable PAR TENANT (logo pour l'instant — les
 *    couleurs ne sont pas dans Business Data du doc 2, donc pas encore
 *    branchées ; les vars restent prêtes si ça change).
 *  - `ink/paper/leaf/clay/muted` : palette FIXE de la plateforme pour le
 *    chrome de la vitrine publique (typo, fonds, CTA WhatsApp). Choisie
 *    pour ne pas retomber sur les trois looks IA par défaut (crème+terracotta,
 *    fond quasi-noir+accent vif, ou style "broadsheet"). Ancrée dans le sujet
 *    réel : reçu/étiquette de marché — d'où l'accent "leaf" fonctionnel
 *    (CTA WhatsApp) plutôt que décoratif.
 *  - `violet/magenta/navy/success/warning/danger` : palette FIXE de la
 *    landing marketing tokoo  et de la console Super Admin (`/admin/*`)
 *    UNIQUEMENT — jamais utilisée sur la vitrine tenant. Réplique pixel
 *    par pixel d'une référence visuelle fournie par le porteur du projet
 *    (capture d'écran, sept. 2026) : violet indigo `#5B21E5` en primaire,
 *    sidebar navy `#0E1130`, dégradé magenta pour les badges "mis en
 *    avant", 4 teintes violettes pour les donuts. Hex extraits par
 *    échantillonnage de pixels réels sur la capture, pas estimés à l'œil.
 *    Namespace séparé de `ink/paper/...` par construction (aucune clé en
 *    commun) : les deux thèmes peuvent coexister dans le même bundle Tailwind
 *    sans collision, cf. `adm-*`/`mkt-*` dans globals.css qui consomment
 *    ces tokens.
 */
const config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand-primary, #00D1A0)",
          secondary: "var(--brand-secondary, #0F172A)",
        },
        ink: "#0F172A",
        paper: "#F8FAFC",
        leaf: "#00D1A0",
        clay: "#C2410C",
        muted: "#64748B",
        violet: {
          50: "#ECFDF8", 100: "#D5F9EF", 200: "#A7F3E0", 300: "#6EE7D0",
          400: "#34D4B5", 500: "#00D1A0", 600: "#007A63", 700: "#006352",
          800: "#007A63", 900: "#065F51", 950: "#064E44",
        },
        magenta: { 500: "#00B98C", 600: "#009979", 700: "#007A63" },
        navy: { 900: "#0F172A", 800: "#172033", 700: "#243047" },
        success: { 50: "#ECFDF5", 600: "#16A34A", 700: "#15803D" },
        warning: { 50: "#FFFBEB", 600: "#D97706", 700: "#B45309" },
        danger: { 50: "#FEF2F2", 600: "#DC2626", 700: "#B91C1C" },
        info: { 50: "#EFF6FF", 600: "#2563EB", 700: "#1D4ED8" },
        primary: { DEFAULT: "#00D1A0", 50: "#ECFDF8", 100: "#D5F9EF", 200: "#A7F3E0", 600: "#00B98C", 700: "#009979", foreground: "#0F172A" },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        // Paire dédiée landing marketing + console admin (voir note ci-dessus) —
        // ne remplace pas display/body, qui restent au service de la vitrine tenant.
        jakarta: ["var(--font-jakarta)", "sans-serif"],
        inter: ["var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        brand: "var(--brand-radius, 0.5rem)",
      },
    },
  },
  plugins: [],
};

module.exports = config;
