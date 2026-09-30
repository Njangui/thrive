import type { ProfessionalServicesHomeModel } from "../services-model";

/**
 * Notre approche : uniquement le texte du commerçant. Aucun contenu
 * générique de type « comprendre / cadrer / accompagner » — l'ancien
 * template affichait cette méthode en trois étapes, identique pour chaque
 * prestataire de service, qu'elle décrive ou non sa façon réelle de
 * travailler. Sans texte, la section n'existe pas (voir le modèle).
 */
export function AboutSection({ about }: { about: NonNullable<ProfessionalServicesHomeModel["about"]> }) {
  const paragraphs = about.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <section className="ps-section" aria-labelledby="ps-about-title">
      <div className="ps-wrap ps-about">
        <h2 id="ps-about-title" className="ps-h2">
          {about.heading}
        </h2>
        <div className="ps-prose">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
