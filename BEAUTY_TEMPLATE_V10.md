# flexco  — Template sectoriel Beauté & Bien-être (V10)

Ajout d'une vitrine publique dédiée au secteur `beauty` / preset `salon`.

## Composition
- Hero immersif avec image réelle du tenant, titre/sous-titre configurables et CTA rendez-vous.
- Cartes de prestations avec image, catégorie, prix réel et durée réelle.
- Bloc éditorial « Notre approche ».
- Galerie de réalisations réelle, uniquement si des images existent.
- Bloc expérience / promesses qualitatives.
- Témoignages réels, uniquement si disponibles.
- Équipe réelle, uniquement si disponible.
- CTA final de prise de rendez-vous.

## Données
Aucun chiffre, avis, prestation, tarif, durée, membre d'équipe ou réalisation n'est inventé. Le template consomme les données du tenant et retombe sur des états vides propres lorsqu'elles n'existent pas.

## Design
Palette par défaut : prune profond, rose poudré, crème et blanc. Direction artistique salon/spa premium : typographie éditoriale, photographie dominante, espaces généreux et responsive mobile.

## Intégration
- `BeautyHome` ajouté à `src/app/_components/sector-home.tsx`.
- `TenantLanding` charge automatiquement services, galerie, équipe et témoignages pour `beauty`.
- Le header de la vitrine peut se superposer au hero du template beauty.
- Le secteur reste compatible avec le reset du design : les données du tenant ne sont pas supprimées.

## Validation
Le projet fourni ne contient pas `node_modules`; un build Next.js complet n'est donc pas exécuté ici. Un contrôle TypeScript ciblé a été effectué avec le compilateur global. Les erreurs restantes sont liées aux dépendances/types absents dans cet environnement, sans erreur de syntaxe signalée dans les modifications beauty.
