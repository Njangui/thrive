import type { RetailHomeInput } from "./model";
import { assignSectionTones, buildRetailHomeModel } from "./model";
import { buildRetailThemeStyle } from "./theme";
import { Categories } from "./sections/categories";
import { Closing } from "./sections/closing";
import { Faq } from "./sections/faq";
import { Gallery } from "./sections/gallery";
import { Hero } from "./sections/hero";
import { PromoBand } from "./sections/promo-band";
import { Quotes } from "./sections/quotes";
import { Shelf } from "./sections/shelf";
import { Story } from "./sections/story";
import { TrustStrip } from "./sections/trust-strip";
import { Videos } from "./sections/videos";
import "./retail-home.css";

/**
 * Page d'accueil de la vitrine « boutique » (secteur `retail`).
 *
 * Trois étapes, chacune dans son fichier :
 *   1. `buildRetailHomeModel` décide de TOUT (sections présentes, liens,
 *      libellés, nombre de cartes) à partir des données réelles ;
 *   2. `buildRetailThemeStyle` transforme la couleur du commerçant en
 *      jetons CSS lisibles ;
 *   3. les composants de `sections/` affichent, sans rien décider.
 *
 * Ce composant ne fait donc qu'assembler. Ordre de lecture : hero →
 * promesses → catégories → sélection → offres → à propos → vidéos → avis
 * → galerie → questions → clôture. Une section sans matière réelle
 * disparaît ; il n'y a pas de bloc vide ni de lien mort.
 */
export function RetailHome(input: RetailHomeInput) {
  const model = buildRetailHomeModel(input);
  const organizationId = input.site.tenant.organizationId;
  const tones = assignSectionTones(model);

  return (
    <div className="rt-home" data-preview={model.preview ? "true" : undefined} style={buildRetailThemeStyle(input.site.accent)}>
      <Hero hero={model.hero} organizationId={organizationId} />
      <TrustStrip items={model.trust} />
      {model.categories && <Categories data={model.categories} tone={tones.categories ?? "white"} />}
      {model.shelf && <Shelf data={model.shelf} organizationId={organizationId} tone={tones.shelf ?? "white"} />}
      {model.promo && <PromoBand data={model.promo} organizationId={organizationId} />}
      {model.story && <Story data={model.story} tone={tones.story ?? "white"} />}
      <Videos videos={model.videos} />
      {model.quotes && <Quotes data={model.quotes} tone={tones.quotes ?? "white"} />}
      {model.gallery && <Gallery data={model.gallery} tone={tones.gallery ?? "white"} />}
      {model.faq && <Faq data={model.faq} organizationId={organizationId} tone={tones.faq ?? "white"} />}
      {model.closing && <Closing data={model.closing} organizationId={organizationId} />}
    </div>
  );
}
