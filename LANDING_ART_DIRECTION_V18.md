# tokoo  — Landing Art Direction V18

## Objective
Raise the tenant storefronts from "good template" to a sector-specific premium experience while keeping the data-driven architecture intact.

## Sector-by-sector direction

### Real estate
- Private-client / luxury editorial direction.
- Full-bleed property imagery, restrained typography, dark teal/green, high-contrast search module.
- Added a floating inventory card and vertical location label to create depth without hiding the property.
- Property cards now have stronger lift/hover behavior and category tiles receive an understated directional affordance.

### Restaurant
- Sensory dining direction: dark green, warm orange accent, large photography and editorial serif moments.
- Added a circular "cuisine / passion" stamp and location signature to make the hero feel like a hospitality brand rather than a SaaS template.
- Menu cards and story photography use stronger depth and image motion.

### Retail
- Fashion/editorial direction: image-led hero, restrained typography, category rail, product-first merchandising.
- Added a floating edition ticket in the hero to create a magazine-like composition.
- Product/category hover behavior now feels more tactile while remaining lightweight.

### Beauty
- Quiet-luxury direction: warm dark plum, soft neutral surfaces, generous whitespace, close-up imagery.
- Strengthened hero depth, service-card treatment and gallery image motion.

### Professional services
- Institutional premium direction: navy/blue, structured grids, strong hierarchy, subtle technical geometry.
- Strengthened hero depth, service-card elevation and domain cards with understated orbital geometry.

### Generic business
- Brand-first fallback rather than a plain catalogue template.
- Added a subtle orbit motif representing brand, offer and story while preserving the tenant's own imagery and identity.

## Research references
The visual direction was informed by current 2026 design roundups and category benchmarks:
- Luxury real estate: Zarla's 2026 examples emphasize full-bleed property photography, restrained editorial typography, proof points and invitation-style CTAs. The 2026 SwiftPro showcase also highlights cinematic presentation and editorial type as current high-end patterns.
- Restaurants: 2026 restaurant design roundups consistently emphasize food photography, visible menu/reservation paths, atmosphere, and mobile-first conversion.
- Professional services: current examples emphasize clear hierarchy, modern typography, trust-building content and making complex expertise easy to understand.

These references were used as art-direction input, not copied as templates.

## Implementation
- Changes are localized primarily to `src/app/_components/sector-home.tsx` and `src/app/globals.css`.
- No external image URL dependency was introduced.
- Existing tenant data remains the priority; demo assets only appear when the tenant has insufficient content, as already designed in the storefront architecture.
- Motion respects `prefers-reduced-motion`.
- Mobile safeguards hide non-essential decorative hero elements and preserve the conversion path.

## Validation
- TSX parser diagnostics: 0 syntax errors in `sector-home.tsx`.
- CSS braces/parentheses balanced.
- Full `npm run typecheck` / `npm run lint` could not be completed because the dependency installation did not finish in the execution environment; the existing project archive has no committed `node_modules`.
