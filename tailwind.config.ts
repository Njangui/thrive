import type { Config } from "tailwindcss";

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
 *    landing marketing SME-OS et de la console Super Admin (`/admin/*`)
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
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand-primary, #0f172a)",
          secondary: "var(--brand-secondary, #10b981)",
        },
        ink: "#1C1B19",
        paper: "#F3F1EC",
        leaf: "#178A4C",
        clay: "#C1562C",
        muted: "#6B6459",
        violet: {
          50: "#F5F2FE",
          100: "#ECE6FD",
          200: "#D6C9FA",
          300: "#B29CF0",
          400: "#8F6AEA",
          500: "#6D3EE8",
          600: "#5B21E5",
          700: "#4A15D1",
          800: "#3D10A8",
          900: "#2E0C7E",
          950: "#1F0857",
        },
        magenta: {
          500: "#B026DE",
          600: "#9A1FD8",
          700: "#7E17B8",
        },
        navy: {
          900: "#0E1130",
          800: "#171A3A",
          700: "#232752",
        },
        success: { 50: "#E4F8EE", 600: "#16A34A", 700: "#15803D" },
        warning: { 50: "#FEF4E3", 600: "#D97706", 700: "#B45309" },
        danger: { 50: "#FEEBEA", 600: "#DC2626", 700: "#B91C1C" },
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

export default config;
