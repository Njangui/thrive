import Link from "next/link";
import type { StorefrontProduct, StorefrontCategory } from "@/application/services/catalog-service";
import type { ServiceSummary, TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS, categoryPath } from "@/application/config/storefront-routes";
import { formatPrice } from "@/lib/format";
import { StorefrontImage } from "./storefront/storefront-image";
import { IconStar } from "./storefront/storefront-icons";
import { Container } from "./storefront/storefront-ui";

/**
 * Lot O : la réservation en ligne est réservée à Starter+ — `/rendez-vous`
 * répond 404 sans l'offre (voir `capabilities.bookingEnabled`). Les CTA
 * « Prendre rendez-vous » des vitrines sectorielles retombent alors sur la
 * page Contact plutôt que de pointer vers une page inexistante.
 */
function bookingHref(site: StorefrontSite) {
  return site.capabilities.bookingEnabled ? STOREFRONT_PATHS.booking : STOREFRONT_PATHS.contact;
}

function locationLabel(address: string | null, fallback: string) {
  const parts = (address ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return fallback;
  return parts.length > 2 ? parts.slice(-2).join(" · ") : parts.join(" · ");
}

function Initials({ name }: { name: string }) {
  return <span className="sector-avatar" aria-hidden>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase()}</span>;
}

function Stars({ rating }: { rating: number | null }) {
  return <span className="sector-stars" aria-label={rating == null ? undefined : `Note ${rating} sur 5`}>{[1,2,3,4,5].map((i) => <IconStar key={i} className={`h-3.5 w-3.5 ${rating != null && i <= rating ? "fill-current" : ""}`} />)}</span>;
}

function PropertyCard({ product, realEstate = false }: { product: StorefrontProduct; realEstate?: boolean }) {
  return (
    <Link href={product.slug ? `/produits/${product.slug}` : STOREFRONT_PATHS.catalog} className="sector-property-card group">
      <div className="sector-property-media">
        <StorefrontImage src={product.imageUrl} alt={product.name} sizes="(min-width: 1024px) 22vw, 90vw" className="transition-transform duration-500 group-hover:scale-105" fallbackLabel="" />
        {product.badges[0] && <span className="sector-property-badge">{product.badges[0] === "out_of_stock" ? "Indisponible" : product.badges[0] === "promo" ? "À saisir" : "À vendre"}</span>}
        <span className="sector-property-heart" aria-hidden>♡</span>
      </div>
      <div className="sector-property-body">
        <h3>{product.name}</h3>
        {product.categoryName && <p className="sector-property-meta">{product.categoryName}</p>}
        {product.description && <p className="sector-property-desc">{product.description}</p>}
        <div className="sector-property-price">{formatPrice(product.unitPrice)}</div>
        {!realEstate && <span className="sector-property-link">Découvrir →</span>}
        {realEstate && <span className="sector-property-link">Voir le bien →</span>}
      </div>
    </Link>
  );
}

export function RealEstateHome({
  site,
  products,
  categories,
  services,
  testimonials,
}: {
  site: StorefrontSite;
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  services: ServiceSummary[];
  testimonials: TestimonialSummary[];
}) {
  const heroImage = site.heroMediaUrl ?? products[0]?.imageUrl ?? site.tenant.bannerUrl ?? "/images/showcase/realestate-hero.svg";
  const storyImage = site.tenant.bannerUrl ?? products[0]?.imageUrl ?? "/images/showcase/demo/realestate-story.jpg";
  const stats = site.stats.slice(0, 4);
  const demoStats = [
    { key: "demo1", value: "120+", label: "biens en vitrine" },
    { key: "demo2", value: "4", label: "types de biens" },
    { key: "demo3", value: "24h", label: "délai de réponse" },
    { key: "demo4", value: "5/5", label: "note moyenne" },
  ];
  const featured = products.slice(0, 4);
  const propertyTypes = categories.slice(0, 4);
  const serviceItems = services.slice(0, 6);
  const demoProperties = [
    { name: "Appartement moderne — Bastos", price: "125 000 FCFA / mois", type: "Appartement", image: "/images/showcase/demo/realestate-1.jpg" },
    { name: "Villa familiale — Odza", price: "85 000 000 FCFA", type: "Villa", image: "/images/showcase/demo/realestate-2.jpg" },
    { name: "Terrain résidentiel — Nkolbisson", price: "18 500 000 FCFA", type: "Terrain", image: "/images/showcase/demo/realestate-3.jpg" },
    { name: "Duplex contemporain — Essos", price: "62 000 000 FCFA", type: "Duplex", image: "/images/showcase/demo/realestate-4.jpg" },
  ];
  const demoTypes = [
    { name: "Maisons", image: "/images/showcase/demo/realestate-1.jpg" },
    { name: "Appartements", image: "/images/showcase/demo/realestate-2.jpg" },
    { name: "Terrains", image: "/images/showcase/demo/realestate-3.jpg" },
    { name: "Bureaux", image: "/images/showcase/demo/realestate-4.jpg" },
  ];
  const demoTestimonials = [
    { name: "Client exemple", text: "Une recherche plus claire et un accompagnement simple du premier contact à la visite." },
    { name: "Acheteur exemple", text: "Les informations essentielles étaient réunies au même endroit, ce qui m’a fait gagner du temps." },
  ];

  return <div className="sector-realestate-home">
    <section className="re-hero">
      <div className="re-hero-bg">{heroImage && <StorefrontImage src={heroImage} alt="" priority sizes="100vw" fallbackLabel="" />}</div>
      <div className="re-hero-overlay" />
      <Container className="re-hero-inner">
        <div className="re-hero-copy">
          <span className="re-eyebrow">AGENCE IMMOBILIÈRE</span>
          <h1>{site.config.heroTitle?.trim() ? site.config.heroTitle.trim() : <>Trouvez le bien qui <span className="re-hero-accent">correspond à vos rêves</span></>}</h1>
          <p>{site.config.heroSubtitle?.trim() || site.tenant.description || "Découvrez une sélection de biens immobiliers avec les informations essentielles pour avancer dans votre projet."}</p>
          <div className="re-hero-highlights">
            {site.highlights.slice(0, 3).map((item) => <div key={item.title}><span className="re-highlight-icon">✓</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span></div>)}
          </div>
        </div>
        <div className="re-hero-visual-note"><strong>Biens disponibles</strong><span>{site.capabilities.productCount}</span></div>
        <div className="re-hero-floating-card">
          <span className="re-floating-kicker">SÉLECTION · {site.tenant.name.toUpperCase()}</span>
          <strong>{featured.length ? `${featured.length} biens à découvrir` : "Une sélection soigneusement présentée"}</strong>
          <small>{site.capabilities.productCount > 0 ? "Mis à jour depuis votre catalogue" : "Votre catalogue apparaîtra ici"}</small>
          <span className="re-floating-arrow">↗</span>
        </div>
        <div className="re-hero-side-label">{site.tenant.name.toUpperCase()} <span>—</span> {locationLabel(site.tenant.address, "VOTRE DESTINATION")}</div>
      </Container>
      <div className="re-search-card">
        <div className="re-search-tabs"><button className="active">Acheter</button><button>Louer</button><button>Investir</button></div>
        <div className="re-search-fields">
          <div><small>Type de bien</small><strong>Maison, appartement, terrain</strong></div>
          <div><small>Région</small><strong>Toutes les régions</strong></div>
          <div><small>Ville</small><strong>Toutes les villes</strong></div>
          <div><small>Budget</small><strong>Tout budget</strong></div>
          <Link href={STOREFRONT_PATHS.catalog} className="re-search-button">⌕ Rechercher</Link>
        </div>
      </div>
    </section>

    <section className="re-featured section-pad">
      <Container className="re-featured-grid">
        <div className="re-intro">
          <span className="re-eyebrow">NOS BIENS EN VEDETTE</span>
          <h2>Des biens d’exception pour tous vos projets</h2>
          <p>Découvrez notre sélection de biens immobiliers soigneusement choisis pour répondre à vos besoins et à vos ambitions.</p>
          <Link href={STOREFRONT_PATHS.catalog} className="re-green-button">Voir tous les biens <span>→</span></Link>
        </div>
        <div className="re-property-grid">{featured.length ? featured.map((p) => <PropertyCard key={p.id} product={p} realEstate />) : demoProperties.map((p) => <Link key={p.name} href={STOREFRONT_PATHS.catalog} className="sector-property-card group demo-property-card"><div className="sector-property-media"><StorefrontImage src={p.image} alt="" sizes="(min-width: 1024px) 22vw, 90vw" className="transition-transform duration-500 group-hover:scale-105" fallbackLabel=""/><span className="sector-property-badge">Exemple</span><span className="sector-property-heart" aria-hidden>♡</span></div><div className="sector-property-body"><h3>{p.name}</h3><p className="sector-property-meta">{p.type}</p><p className="sector-property-desc">Aperçu de présentation — remplacez cette annonce par vos biens réels.</p><div className="sector-property-price">{p.price}</div><span className="sector-property-link">Voir l’exemple →</span></div></Link>)}</div>
      </Container>
    </section>

    <section className="re-services section-pad">
      <Container className="re-services-grid">
        <div className="re-services-media">{storyImage && <StorefrontImage src={storyImage} alt="" sizes="(min-width: 1024px) 42vw, 100vw" />}</div>
        <div className="re-services-copy">
          <span className="re-eyebrow">NOS SERVICES</span>
          <h2>Une expérience immobilière complète et simplifiée</h2>
          <p>Nous vous accompagnons à chaque étape de votre projet, de la recherche du bien à la signature, avec des services adaptés à vos besoins.</p>
          <div className="re-service-list">
            {(serviceItems.length ? serviceItems : [
              { title: "Recherche personnalisée", subtitle: "Définissez votre zone, votre budget et vos critères." },
              { title: "Visite organisée", subtitle: "Un créneau simple pour découvrir le bien." },
              { title: "Accompagnement", subtitle: "Un interlocuteur vous accompagne jusqu’à la suite." },
              ...site.highlights,
            ]).slice(0, 6).map((item, i) => {
              const title = "name" in item ? item.name : item.title;
              const description = "description" in item ? item.description : item.subtitle;
              return <div key={`${title}-${i}`}><span className="re-service-icon">⌂</span><span><strong>{title}</strong><small>{description || "Un accompagnement adapté à votre projet"}</small></span></div>;
            })}
          </div>
        </div>
      </Container>
    </section>

    <section className="re-stats">
      <Container className="re-stats-inner">
        <div><span className="re-eyebrow">{stats.length ? "EN QUELQUES CHIFFRES" : "UNE PRÉSENTATION POSSIBLE"}</span><h2>Une agence qui donne immédiatement envie d’aller plus loin.</h2><p>{stats.length ? "Des indicateurs issus de l’activité réelle de cette entreprise." : "Cette zone se personnalise automatiquement dès que l’entreprise renseigne ses indicateurs."}</p></div>
        <div className="re-stat-grid">{(stats.length ? stats : demoStats).map((s) => <div key={s.key}><strong>{s.value}</strong><span>{s.label}{stats.length ? "" : " · Exemple"}</span></div>)}</div>
      </Container>
    </section>

    <section className="re-testimonials section-pad">
      <Container className="re-testimonials-grid">
        <div className="re-intro"><span className="re-eyebrow">TÉMOIGNAGES</span><h2>Ils nous ont fait confiance</h2><p>Découvrez ce que nos clients disent de leur expérience avec {site.tenant.name}.</p><Link href={STOREFRONT_PATHS.contact} className="re-green-button">Nous contacter <span>→</span></Link></div>
        <div className="re-testimonial-cards">{testimonials.length ? testimonials.slice(0, 3).map((t) => <figure key={t.id} className="re-testimonial"><Initials name={t.authorName}/><blockquote>« {t.content} »</blockquote><figcaption><strong>{t.authorName}</strong><Stars rating={t.rating}/></figcaption></figure>) : demoTestimonials.map((t) => <figure key={t.name} className="re-testimonial demo-testimonial"><Initials name={t.name}/><blockquote>« {t.text} »</blockquote><figcaption><strong>{t.name}</strong><small>Exemple de témoignage</small></figcaption></figure>)}</div>
      </Container>
    </section>

    <section className="re-type-section section-pad">
      <Container><div className="re-type-head"><div><span className="re-eyebrow">TYPES DE BIENS</span><h2>Les biens qui correspondent à votre projet</h2></div><Link href={STOREFRONT_PATHS.categories}>Voir toutes les catégories →</Link></div><div className="re-type-grid">{propertyTypes.length ? propertyTypes.map((c) => <Link key={c.id} href={categoryPath(c.slug)} className="re-type-card"><StorefrontImage src={c.imageUrl} alt={c.name} sizes="25vw" fallbackLabel=""/><strong>{c.name}</strong><span>{c.productCount} bien{c.productCount > 1 ? "s" : ""}</span></Link>) : demoTypes.map((type) => <Link key={type.name} href={STOREFRONT_PATHS.catalog} className="re-type-card demo-type-card"><div className="demo-type-image"><StorefrontImage src={type.image} alt="" sizes="25vw" fallbackLabel=""/><span>Exemple</span></div><strong>{type.name}</strong><span>Voir les annonces →</span></Link>)}</div></Container>
    </section>
  </div>;
}

export function RetailHome({
  site,
  products,
  categories,
  promotions,
  testimonials,
}: {
  site: StorefrontSite;
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  promotions: StorefrontProduct[];
  testimonials: TestimonialSummary[];
}) {
  const heroImage = site.heroMediaUrl ?? products[0]?.imageUrl ?? site.tenant.bannerUrl ?? "/images/showcase/retail-hero.svg";
  const editorialImage = products[1]?.imageUrl ?? site.tenant.bannerUrl ?? "/images/demo/retail-story.svg";
  const newArrivals = products.slice(0, 6);
  const promoItems = promotions.slice(0, 4);
  const categoryItems = categories.slice(0, 6);
  const demoCategories = [
    { name: "Mode", image: "/images/demo/retail-mode.svg" },
    { name: "Accessoires", image: "/images/demo/retail-accessories.svg" },
    { name: "Maison", image: "/images/demo/retail-home.svg" },
    { name: "Beauté", image: "/images/demo/retail-beauty.svg" },
  ];
  const demoTestimonials = [
    { name: "Cliente exemple", text: "Une sélection facile à parcourir et un contact direct quand j’ai besoin d’aide." },
    { name: "Client exemple", text: "Le catalogue donne immédiatement une idée des produits et des prix." },
  ];

  return <div className="sector-retail-home">
    <section className="boutique-hero">
      <div className="boutique-hero-media">
        {heroImage && <StorefrontImage src={heroImage} alt="" priority sizes="(min-width: 900px) 58vw, 100vw" fallbackLabel="" />}
      </div>
      <div className="boutique-hero-shade" />
      <Container className="boutique-hero-inner">
        <div className="boutique-hero-copy">
          <span className="boutique-eyebrow">{site.blueprint.eyebrow.toUpperCase()} · {site.tenant.name.toUpperCase()}</span>
          <h1>{site.config.heroTitle?.trim() || <>Votre univers.<br/><em>Votre sélection.</em></>}</h1>
          <p>{site.config.heroSubtitle?.trim() || site.tenant.description || "Une sélection pensée pour celles et ceux qui aiment les belles pièces, les choix simples et un service proche."}</p>
          <div className="boutique-hero-actions">
            <Link href={STOREFRONT_PATHS.catalog} className="boutique-primary">Explorer la boutique <span>↗</span></Link>
            {promoItems.length > 0 && <Link href={STOREFRONT_PATHS.promotions} className="boutique-secondary">Voir les offres</Link>}
          </div>
          <div className="boutique-trust">
            {site.highlights.slice(0, 3).map((h) => <div key={h.title}><strong>{h.title}</strong><span>{h.subtitle}</span></div>)}
          </div>
        </div>
        <div className="boutique-hero-card">
          <span>COLLECTION</span><strong>{newArrivals.length ? "Nouvelle sélection" : "La boutique"}</strong><small>{newArrivals.length ? `${newArrivals.length} pièces à découvrir` : "Découvrez notre catalogue"}</small>
        </div>
      </Container>
      <div className="boutique-hero-ticket"><span>ÉDITION</span><strong>{site.tenant.name}</strong><small>{newArrivals.length ? `${newArrivals.length} pièces en ligne` : "Nouvelle collection"}</small></div>
      <div className="boutique-scroll">DÉFILER <span>↓</span></div>
    </section>

    <section className="boutique-categories">
      <Container>
        <div className="boutique-section-head"><div><span className="boutique-kicker">SHOP PAR CATÉGORIE</span><h2>Choisissez votre univers</h2></div><Link href={STOREFRONT_PATHS.categories}>Toutes les catégories ↗</Link></div>
        <div className="boutique-category-rail">
          {categoryItems.length ? categoryItems.map((c, i) => <Link key={c.id} href={categoryPath(c.slug)} className={`boutique-category-card boutique-cat-${i % 3}`}><div>{c.imageUrl && <StorefrontImage src={c.imageUrl} alt={c.name} sizes="(min-width: 900px) 16vw, 45vw" fallbackLabel="" />}</div><span>{c.name}</span><small>{c.productCount} {c.productCount > 1 ? "articles" : "article"}</small></Link>) : demoCategories.map((category, i) => <Link key={category.name} href={STOREFRONT_PATHS.catalog} className={`boutique-category-card boutique-cat-${i % 3} demo-retail-category`}><div><StorefrontImage src={category.image} alt="" sizes="(min-width: 900px) 16vw, 45vw" fallbackLabel="" /></div><span>{category.name}</span><small>Exemple de catégorie</small></Link>)}
        </div>
      </Container>
    </section>

    <section className="boutique-products section-pad">
      <Container>
        <div className="boutique-section-head"><div><span className="boutique-kicker">SÉLECTION DU MOMENT</span><h2>Les pièces que l’on remarque</h2><p>Une sélection de produits publiés dans votre catalogue, présentés avec leur vrai prix et leur disponibilité.</p></div><Link href={STOREFRONT_PATHS.catalog}>Voir toute la boutique ↗</Link></div>
        {newArrivals.length ? <div className="boutique-product-grid">{newArrivals.map((p) => <RetailProductCard key={p.id} product={p} />)}</div> : <div className="boutique-product-grid">{[
          { name: "Pièce signature", price: 25000, image: "/images/demo/retail-fashion.svg" },
          { name: "Sac essentiel", price: 35000, image: "/images/demo/retail-bag.svg" },
          { name: "Objet maison", price: 18000, image: "/images/demo/retail-home.svg" },
        ].map((p) => <Link key={p.name} href={STOREFRONT_PATHS.catalog} className="boutique-product-card group demo-boutique-product"><div className="boutique-product-media"><StorefrontImage src={p.image} alt="" sizes="30vw" fallbackLabel=""/><span className="boutique-product-badge">Exemple</span><span className="boutique-product-arrow">↗</span></div><div className="boutique-product-info"><div><h3>{p.name}</h3><span>Exemple de contenu</span></div><strong>{formatPrice(p.price)}</strong></div></Link>)}</div>}
      </Container>
    </section>

    {promoItems.length > 0 && <section className="boutique-promo section-pad"><Container className="boutique-promo-grid"><div className="boutique-promo-copy"><span className="boutique-kicker">OFFRES DU MOMENT</span><h2>Les belles opportunités ne restent pas longtemps.</h2><p>Retrouvez ici les produits actuellement en promotion dans votre catalogue.</p><Link href={STOREFRONT_PATHS.promotions} className="boutique-dark-button">Découvrir les offres ↗</Link></div><div className="boutique-promo-products">{promoItems.map((p) => <RetailProductCard key={p.id} product={p} compact />)}</div></Container></section>}

    <section className="boutique-editorial section-pad">
      <Container className="boutique-editorial-grid">
        <div className="boutique-editorial-media">{editorialImage && <StorefrontImage src={editorialImage} alt="" sizes="(min-width: 900px) 50vw, 100vw" fallbackLabel="" />}<span className="boutique-editorial-label">{site.tenant.name}<br/><em>BOUTIQUE</em></span></div>
        <div className="boutique-editorial-copy"><span className="boutique-kicker">L&apos;ESPRIT DE LA BOUTIQUE</span><h2>Une vitrine qui ressemble à votre entreprise.</h2><p>{site.tenant.description || `Découvrez l'univers de ${site.tenant.name}, ses produits et les nouveautés disponibles.`}</p><div className="boutique-editorial-list"><div><b>01</b><span><strong>Une sélection vivante</strong><small>Votre catalogue reste au centre de l&apos;expérience.</small></span></div><div><b>02</b><span><strong>Un parcours simple</strong><small>Du premier regard jusqu&apos;à la prise de contact.</small></span></div><div><b>03</b><span><strong>Un service de proximité</strong><small>Contactez directement la boutique lorsque vous avez besoin de conseil.</small></span></div></div><Link href={STOREFRONT_PATHS.contact} className="boutique-text-link">Découvrir notre histoire ↗</Link></div>
      </Container>
    </section>

    <section className="boutique-testimonials section-pad"><Container><div className="boutique-section-head"><div><span className="boutique-kicker">ILS NOUS FONT CONFIANCE</span><h2>Des expériences qui comptent</h2></div></div><div className="boutique-testimonial-grid">{testimonials.length ? testimonials.slice(0,3).map((t) => <figure key={t.id}><Stars rating={t.rating}/><blockquote>“{t.content}”</blockquote><figcaption><Initials name={t.authorName}/><span><strong>{t.authorName}</strong><small>Client</small></span></figcaption></figure>) : demoTestimonials.map((t) => <figure key={t.name} className="demo-testimonial"><Stars rating={5}/><blockquote>“{t.text}”</blockquote><figcaption><Initials name={t.name}/><span><strong>{t.name}</strong><small>Exemple de témoignage</small></span></figcaption></figure>)}</div></Container></section>

    <section className="boutique-final-cta">
      <Container className="boutique-final-inner"><div><span className="boutique-kicker">BIENVENUE CHEZ {site.tenant.name.toUpperCase()}</span><h2>Prêt à trouver votre prochaine pièce préférée ?</h2></div><Link href={STOREFRONT_PATHS.catalog} className="boutique-light-button">Explorer la boutique ↗</Link></Container>
    </section>
  </div>;
}

function RetailProductCard({ product, compact = false }: { product: StorefrontProduct; compact?: boolean }) {
  const badge = product.badges.find((b) => b !== "featured");
  return <Link href={product.slug ? `/produits/${product.slug}` : STOREFRONT_PATHS.catalog} className={`boutique-product-card ${compact ? "compact" : ""} group`}>
    <div className="boutique-product-media">
      <StorefrontImage src={product.imageUrl} alt={product.name} sizes={compact ? "20vw" : "30vw"} className="transition-transform duration-700 group-hover:scale-105" fallbackLabel="" />
      {badge && <span className="boutique-product-badge">{badge === "promo" ? `-${product.discountPercent ?? 0}%` : badge === "new" ? "Nouveau" : badge === "bestseller" ? "Best-seller" : badge === "out_of_stock" ? "Épuisé" : "Sélection"}</span>}
      <span className="boutique-product-arrow">↗</span>
    </div>
    <div className="boutique-product-info"><div><h3>{product.name}</h3>{product.categoryName && <span>{product.categoryName}</span>}</div><strong>{formatPrice(product.unitPrice)}</strong></div>
    {product.compareAtPrice && product.compareAtPrice > product.unitPrice && <div className="boutique-old-price">{formatPrice(product.compareAtPrice)}</div>}
  </Link>;
}


export function BeautyHome({
  site,
  services,
  gallery,
  testimonials,
  team,
}: {
  site: StorefrontSite;
  services: ServiceSummary[];
  gallery: { url: string; productName: string }[];
  testimonials: TestimonialSummary[];
  team: { userId: string; fullName: string | null; avatarUrl: string | null; role: string }[];
}) {
  const heroImage = site.heroMediaUrl ?? gallery[0]?.url ?? site.tenant.bannerUrl ?? services.find((s) => s.imageUrl)?.imageUrl ?? "/images/showcase/beauty-hero.svg";
  const storyImage = gallery[1]?.url ?? gallery[0]?.url ?? site.tenant.bannerUrl ?? "/images/tenant-default-story.svg";
  const featuredServices = services.slice(0, 6);
  const galleryItems = gallery.slice(0, 6);
  const demoServices = [
    { name: "Soin signature", price: 15000, durationMinutes: 60, categoryName: "Soin", description: "Une prestation pensée pour votre moment de détente.", image: "/images/demo/beauty-spa.svg" },
    { name: "Mise en beauté", price: 20000, durationMinutes: 90, categoryName: "Beauté", description: "Un résultat soigné, adapté à votre style.", image: "/images/demo/beauty-hair.svg" },
    { name: "Rituel bien-être", price: 25000, durationMinutes: 75, categoryName: "Bien-être", description: "Une parenthèse complète pour prendre soin de vous.", image: "/images/demo/beauty-facial.svg" },
  ];
  const demoGallery = [
    { url: "/images/demo/beauty-spa.svg", productName: "Rituel bien-être" },
    { url: "/images/demo/beauty-hair.svg", productName: "Mise en beauté" },
    { url: "/images/demo/beauty-nails.svg", productName: "Beauté des mains" },
    { url: "/images/demo/beauty-facial.svg", productName: "Soin visage" },
  ];
  const demoTestimonials = [
    { name: "Cliente exemple", text: "Une parenthèse agréable, une équipe attentive et une expérience simple à réserver." },
    { name: "Cliente fidèle", text: "Les prestations et les informations sont claires avant même de venir." },
  ];
  const rating = site.stats.find((s) => s.key === "rating");
  const durationLabel = (minutes: number | null) => {
    if (!minutes) return null;
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} h`;
  };

  return <div className="sector-beauty-home">
    <section className="beauty-hero">
      <div className="beauty-hero-media">
        {heroImage && <StorefrontImage src={heroImage} alt="" priority sizes="100vw" fallbackLabel="" />}
      </div>
      <div className="beauty-hero-wash" />
      <Container className="beauty-hero-inner">
        <div className="beauty-hero-copy">
          <span className="beauty-kicker">{site.blueprint.eyebrow.toUpperCase()}</span>
          <h1>{site.config.heroTitle?.trim() || "Prenez soin de vous"}</h1>
          <p>{site.config.heroSubtitle?.trim() || site.tenant.description || `Un moment pour vous, chez ${site.tenant.name}. Des prestations pensées pour vous faire ressortir du salon en vous sentant mieux.`}</p>
          <div className="beauty-hero-actions">
            <Link href={bookingHref(site)} className="beauty-primary-button">Prendre rendez-vous <span>↗</span></Link>
            <Link href={STOREFRONT_PATHS.services} className="beauty-ghost-button">Voir les prestations</Link>
          </div>
          <div className="beauty-trust-row">
            {site.highlights.slice(0, 3).map((h) => <div key={h.title}><span>✦</span><strong>{h.title}<small>{h.subtitle}</small></strong></div>)}
          </div>
        </div>
        <div className="beauty-hero-card">
          <span>VOTRE MOMENT</span>
          <strong>Commencez par choisir votre soin.</strong>
          <small>{featuredServices.length ? `${featuredServices.length} prestations actuellement publiées` : "Prestations disponibles sur demande"}</small>
          {rating && <div className="beauty-rating"><Stars rating={Number(rating.value) || null} /><b>{rating.value}/5</b></div>}
        </div>
      </Container>
      <div className="beauty-hero-scroll">DÉCOUVRIR <span>↓</span></div>
    </section>

    <section className="beauty-services section-pad">
      <Container>
        <div className="beauty-section-head">
          <div><span className="beauty-kicker">NOS PRESTATIONS</span><h2>Des soins choisis pour vous</h2><p>Des tarifs et durées issus directement du catalogue de votre établissement.</p></div>
          <Link href={STOREFRONT_PATHS.services} className="beauty-text-link">Voir toutes les prestations ↗</Link>
        </div>
        {featuredServices.length ? <div className="beauty-service-grid">{featuredServices.map((service, index) => <Link key={service.id} href={`${STOREFRONT_PATHS.services}/${service.slug}`} className={`beauty-service-card beauty-service-${index % 3}`}>
          <div className="beauty-service-image">
            {service.imageUrl ? <StorefrontImage src={service.imageUrl} alt={service.name} sizes="(min-width: 900px) 28vw, 90vw" fallbackLabel="" /> : <div className="beauty-service-placeholder"><span>✦</span></div>}
            <span>{String(index + 1).padStart(2, "0")}</span>
          </div>
          <div className="beauty-service-body"><div><span className="beauty-service-category">{service.categoryName || "Soin"}</span><h3>{service.name}</h3>{service.description && <p>{service.description}</p>}</div><div className="beauty-service-meta"><strong>{formatPrice(service.price)}</strong>{durationLabel(service.durationMinutes) && <small>{durationLabel(service.durationMinutes)}</small>}</div></div>
        </Link>)}</div> : <div className="beauty-service-grid">{demoServices.map((service, index) => <Link key={service.name} href={STOREFRONT_PATHS.services} className={`beauty-service-card beauty-service-${index % 3} demo-beauty-service`}><div className="beauty-service-image"><StorefrontImage src={service.image} alt="" sizes="(min-width: 900px) 28vw, 90vw" fallbackLabel=""/><span>{String(index + 1).padStart(2, "0")}</span></div><div className="beauty-service-body"><div><span className="beauty-service-category">Exemple · {service.categoryName}</span><h3>{service.name}</h3><p>{service.description}</p></div><div className="beauty-service-meta"><strong>{formatPrice(service.price)}</strong><small>{durationLabel(service.durationMinutes)}</small></div></div></Link>)}</div>}
      </Container>
    </section>

    <section className="beauty-ritual section-pad">
      <Container className="beauty-ritual-grid">
        <div className="beauty-ritual-media">{storyImage && <StorefrontImage src={storyImage} alt="" sizes="(min-width: 900px) 48vw, 100vw" fallbackLabel="" />}<span className="beauty-ritual-badge">PRENEZ<br/><em>LE TEMPS</em></span></div>
        <div className="beauty-ritual-copy"><span className="beauty-kicker">NOTRE APPROCHE</span><h2>Un rendez-vous qui commence avant même votre arrivée.</h2><p>{site.tenant.description || `${site.tenant.name} crée une parenthèse où chaque détail compte : accueil, écoute, geste précis et résultat soigné.`}</p><div className="beauty-ritual-list"><div><b>01</b><span><strong>Écouter</strong><small>Comprendre votre besoin avant de commencer.</small></span></div><div><b>02</b><span><strong>Prendre soin</strong><small>Des gestes et un cadre pensés pour votre confort.</small></span></div><div><b>03</b><span><strong>Vous révéler</strong><small>Un résultat adapté à votre style et à vos envies.</small></span></div></div><Link href={bookingHref(site)} className="beauty-dark-button">Réserver mon moment ↗</Link></div>
      </Container>
    </section>

    <section className="beauty-gallery section-pad"><Container><div className="beauty-section-head"><div><span className="beauty-kicker">NOS RÉALISATIONS</span><h2>Le résultat parle de lui-même.</h2></div><Link href={STOREFRONT_PATHS.gallery} className="beauty-text-link">Voir toute la galerie ↗</Link></div><div className="beauty-gallery-grid">{(galleryItems.length ? galleryItems : demoGallery).map((image, i) => <Link key={`${image.url}-${i}`} href={STOREFRONT_PATHS.gallery} className={`beauty-gallery-item beauty-gallery-item-${i % 4}`}><StorefrontImage src={image.url} alt={image.productName || `Réalisation ${i + 1}`} sizes="(min-width: 900px) 25vw, 50vw" fallbackLabel="" /><span>{image.productName || "Réalisation"}{galleryItems.length ? "" : " · Exemple"}</span></Link>)}</div></Container></section>

    <section className="beauty-experience section-pad">
      <Container><div className="beauty-experience-intro"><span className="beauty-kicker">L&apos;EXPÉRIENCE {site.tenant.name.toUpperCase()}</span><h2>Une belle expérience ne s&apos;arrête pas au soin.</h2><p>Votre vitrine met en avant ce qui compte vraiment : les prestations, les réalisations, l&apos;équipe et la possibilité de réserver simplement.</p></div><div className="beauty-experience-grid"><div><span>✦</span><strong>Accueil personnalisé</strong><p>Un premier contact clair et une information accessible.</p></div><div><span>◌</span><strong>Tarifs transparents</strong><p>Le prix affiché provient de votre catalogue.</p></div><div><span>⌁</span><strong>Réservation simple</strong><p>Un parcours direct pour demander votre créneau.</p></div></div></Container>
    </section>

    <section className="beauty-testimonials section-pad"><Container><div className="beauty-section-head"><div><span className="beauty-kicker">TÉMOIGNAGES</span><h2>Des clients qui repartent avec le sourire.</h2></div></div><div className="beauty-testimonial-grid">{testimonials.length ? testimonials.slice(0, 3).map((t) => <figure key={t.id}><Stars rating={t.rating}/><blockquote>“{t.content}”</blockquote><figcaption><Initials name={t.authorName}/><span><strong>{t.authorName}</strong><small>Client</small></span></figcaption></figure>) : demoTestimonials.map((t) => <figure key={t.name} className="demo-testimonial"><Stars rating={5}/><blockquote>“{t.text}”</blockquote><figcaption><Initials name={t.name}/><span><strong>{t.name}</strong><small>Exemple de témoignage</small></span></figcaption></figure>)}</div></Container></section>

    <section className="beauty-team section-pad"><Container><div className="beauty-section-head"><div><span className="beauty-kicker">L&apos;ÉQUIPE</span><h2>Les personnes derrière votre expérience.</h2></div></div><div className="beauty-team-grid">{team.length ? team.slice(0, 4).map((member) => <div key={member.userId} className="beauty-team-card">{member.avatarUrl ? <StorefrontImage src={member.avatarUrl} alt={member.fullName || member.role} sizes="180px" fallbackLabel="" /> : <Initials name={member.fullName || member.role}/>}<div><strong>{member.fullName || member.role}</strong><small>{member.role}</small></div></div>) : [
          { name: "Conseillère beauté", role: "Accueil & conseil" },
          { name: "Expert bien-être", role: "Soins & détente" },
          { name: "Styliste", role: "Beauté & finition" },
        ].map((member) => <div key={member.name} className="beauty-team-card demo-team-card"><div className="beauty-demo-person"><Initials name={member.name}/></div><div><strong>{member.name}</strong><small>{member.role} · Exemple</small></div></div>)}</div></Container></section>

    <section className="beauty-final-cta"><Container className="beauty-final-inner"><div><span className="beauty-kicker">VOTRE PROCHAIN RENDEZ-VOUS</span><h2>Et si vous vous accordiez enfin ce moment ?</h2></div><Link href={bookingHref(site)} className="beauty-light-button">Prendre rendez-vous ↗</Link></Container></section>
  </div>;
}


export function ProfessionalServicesHome({
  site,
  services,
  categories,
  testimonials,
  team,
}: {
  site: StorefrontSite;
  services: ServiceSummary[];
  categories: StorefrontCategory[];
  testimonials: TestimonialSummary[];
  team: { userId: string; fullName: string | null; avatarUrl: string | null; role: string }[];
}) {
  const heroImage = site.heroMediaUrl ?? services.find((s) => s.imageUrl)?.imageUrl ?? site.tenant.bannerUrl ?? "/images/showcase/professional-hero.svg";
  const featuredServices = services.slice(0, 6);
  const featuredCategories = categories.slice(0, 4);
  const demoServices = [
    { name: "Consultation stratégique", price: 50000, durationMinutes: 60, categoryName: "Conseil", description: "Un premier cadrage pour clarifier votre besoin et vos prochaines étapes.", image: "/images/demo/pro-consulting.svg" },
    { name: "Accompagnement personnalisé", price: 85000, durationMinutes: 90, categoryName: "Accompagnement", description: "Une prestation structurée autour de vos objectifs et contraintes.", image: "/images/demo/pro-digital.svg" },
    { name: "Solution sur mesure", price: 120000, durationMinutes: 120, categoryName: "Expertise", description: "Une intervention adaptée à votre contexte et à votre niveau d’exigence.", image: "/images/demo/pro-legal.svg" },
  ];
  const demoDomains = ["Conseil", "Accompagnement", "Expertise", "Solutions digitales"];
  const demoTestimonials = [
    { name: "Client exemple", text: "Une démarche claire, des échanges structurés et un vrai suivi du projet." },
    { name: "Dirigeante exemple", text: "J’ai rapidement compris l’offre et la prochaine étape à prendre." },
  ];
  const rating = site.stats.find((s) => s.key === "rating");
  const durationLabel = (minutes: number | null) => {
    if (!minutes) return null;
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} h`;
  };

  return <div className="sector-professional-home">
    <section className="pro-hero">
      <div className="pro-hero-media">{heroImage && <StorefrontImage src={heroImage} alt="" priority sizes="100vw" fallbackLabel="" />}</div>
      <div className="pro-hero-overlay" />
      <Container className="pro-hero-inner">
        <div className="pro-hero-copy">
          <span className="pro-kicker">{site.blueprint.eyebrow.toUpperCase()}</span>
          <h1>{site.config.heroTitle?.trim() || "Un accompagnement clair, du début à la fin"}</h1>
          <p>{site.config.heroSubtitle?.trim() || site.tenant.description || `${site.tenant.name} transforme vos besoins en solutions concrètes, avec un cadre clair et un interlocuteur dédié.`}</p>
          <div className="pro-actions">
            <Link href={bookingHref(site)} className="pro-primary-button">Demander un rendez-vous <span>↗</span></Link>
            <Link href={STOREFRONT_PATHS.services} className="pro-outline-button">Voir nos services</Link>
          </div>
          <div className="pro-trust-row">{site.highlights.slice(0, 3).map((h) => <div key={h.title}><span>✓</span><strong>{h.title}<small>{h.subtitle}</small></strong></div>)}</div>
        </div>
        <div className="pro-hero-card">
          <span>VOTRE PROJET</span>
          <strong>Parlons d&apos;abord du besoin.</strong>
          <p>Un premier échange permet de cadrer votre demande avant toute proposition.</p>
          {rating && <div className="pro-rating"><Stars rating={Number(rating.value) || null} /><b>{rating.value}/5</b></div>}
        </div>
      </Container>
      <div className="pro-hero-scroll">DÉCOUVRIR <span>↓</span></div>
    </section>

    <section className="pro-services section-pad">
      <Container>
        <div className="pro-section-head"><div><span className="pro-kicker">NOS EXPERTISES</span><h2>Des services pensés autour de vos objectifs.</h2><p>Les prestations affichées ci-dessous proviennent directement du catalogue de votre entreprise.</p></div><Link href={STOREFRONT_PATHS.services} className="pro-text-link">Toutes les prestations ↗</Link></div>
        {featuredServices.length ? <div className="pro-service-grid">{featuredServices.map((service, index) => <Link key={service.id} href={`${STOREFRONT_PATHS.services}/${service.slug}`} className="pro-service-card group">
          <div className="pro-service-number">0{index + 1}</div>
          <div className="pro-service-image">{service.imageUrl ? <StorefrontImage src={service.imageUrl} alt={service.name} sizes="(min-width: 900px) 30vw, 90vw" fallbackLabel="" /> : <div className="pro-service-placeholder">⌁</div>}</div>
          <div className="pro-service-body"><span>{service.categoryName || "Expertise"}</span><h3>{service.name}</h3>{service.description && <p>{service.description}</p>}<div className="pro-service-meta"><strong>{formatPrice(service.price)}</strong>{durationLabel(service.durationMinutes) && <small>{durationLabel(service.durationMinutes)}</small>}<b>Voir le service ↗</b></div></div>
        </Link>)}</div> : <div className="pro-service-grid">{demoServices.map((service, index) => <Link key={service.name} href={STOREFRONT_PATHS.services} className="pro-service-card group demo-pro-service"><div className="pro-service-number">0{index + 1}</div><div className="pro-service-image"><StorefrontImage src={service.image} alt="" sizes="(min-width: 900px) 30vw, 90vw" fallbackLabel="" /></div><div className="pro-service-body"><span>Exemple · {service.categoryName}</span><h3>{service.name}</h3><p>{service.description}</p><div className="pro-service-meta"><strong>{formatPrice(service.price)}</strong><small>{durationLabel(service.durationMinutes)}</small><b>Voir l’exemple ↗</b></div></div></Link>)}</div>}
      </Container>
    </section>

    <section className="pro-domains section-pad"><Container><div className="pro-domain-intro"><div><span className="pro-kicker">DOMAINES D&apos;INTERVENTION</span><h2>Une expertise lisible, sans jargon inutile.</h2></div><p>Explorez les domaines renseignés par l&apos;entreprise et trouvez rapidement le service correspondant à votre situation.</p></div><div className="pro-domain-grid">{featuredCategories.length ? featuredCategories.map((category, index) => <Link key={category.id} href={`${STOREFRONT_PATHS.catalog}?category=${encodeURIComponent(category.slug)}`} className="pro-domain-card"><span>0{index + 1}</span><div><h3>{category.name}</h3><small>Explorer le domaine <b>↗</b></small></div></Link>) : demoDomains.map((name, index) => <Link key={name} href={STOREFRONT_PATHS.services} className="pro-domain-card demo-pro-domain"><span>0{index + 1}</span><div><h3>{name}</h3><small>Exemple de domaine <b>↗</b></small></div></Link>)}</div></Container></section>

    <section className="pro-method section-pad">
      <Container className="pro-method-grid">
        <div className="pro-method-visual"><div className="pro-method-orbit"><span>CLARTÉ</span><span>EXPERTISE</span><span>CONFIANCE</span><i>↗</i></div><div className="pro-method-caption">UNE MÉTHODE SIMPLE<br/><em>POUR DES DÉCISIONS PLUS CLAIRES</em></div></div>
        <div className="pro-method-copy"><span className="pro-kicker">NOTRE APPROCHE</span><h2>Votre projet mérite un cadre, pas une succession de surprises.</h2><p>{site.tenant.description || `${site.tenant.name} privilégie un accompagnement lisible : comprendre la demande, définir le périmètre, avancer avec un interlocuteur identifié et garder les prochaines étapes visibles.`}</p><div className="pro-steps"><div><b>01</b><span><strong>Comprendre</strong><small>Votre besoin, vos contraintes et le résultat attendu.</small></span></div><div><b>02</b><span><strong>Cadrer</strong><small>Une prestation et un périmètre compréhensibles avant d&apos;avancer.</small></span></div><div><b>03</b><span><strong>Accompagner</strong><small>Un suivi clair jusqu&apos;à la livraison ou la prochaine étape.</small></span></div></div><Link href={bookingHref(site)} className="pro-dark-button">Parler de mon projet ↗</Link></div>
      </Container>
    </section>

    <section className="pro-proof section-pad"><Container><div className="pro-proof-top"><div><span className="pro-kicker">LA RELATION CLIENT</span><h2>Un professionnel à vos côtés, pas seulement une prestation.</h2></div><div className="pro-proof-mark">{site.tenant.name}<br/><strong>PRO</strong></div></div><div className="pro-proof-grid"><div><span>01</span><strong>Un interlocuteur identifié</strong><p>Vous savez à qui adresser votre demande et où en est votre dossier.</p></div><div><span>02</span><strong>Des informations accessibles</strong><p>Services, tarifs, disponibilité et contact sont présentés au même endroit.</p></div><div><span>03</span><strong>Un prochain pas évident</strong><p>Demandez un rendez-vous ou contactez directement l&apos;entreprise.</p></div></div></Container></section>

    <section className="pro-testimonials section-pad"><Container><div className="pro-section-head"><div><span className="pro-kicker">TÉMOIGNAGES</span><h2>Ce que disent les personnes accompagnées.</h2></div></div><div className="pro-testimonial-grid">{testimonials.length ? testimonials.slice(0, 3).map((t) => <figure key={t.id}><Stars rating={t.rating}/><blockquote>“{t.content}”</blockquote><figcaption><Initials name={t.authorName}/><span><strong>{t.authorName}</strong><small>Client</small></span></figcaption></figure>) : demoTestimonials.map((t) => <figure key={t.name} className="demo-testimonial"><Stars rating={5}/><blockquote>“{t.text}”</blockquote><figcaption><Initials name={t.name}/><span><strong>{t.name}</strong><small>Exemple de témoignage</small></span></figcaption></figure>)}</div></Container></section>

    <section className="pro-team section-pad"><Container><div className="pro-section-head"><div><span className="pro-kicker">L&apos;ÉQUIPE</span><h2>Les personnes qui vous accompagnent.</h2></div></div><div className="pro-team-grid">{team.length ? team.slice(0, 4).map((member) => <div key={member.userId} className="pro-team-card">{member.avatarUrl ? <StorefrontImage src={member.avatarUrl} alt={member.fullName || member.role} sizes="180px" fallbackLabel="" /> : <Initials name={member.fullName || member.role}/>}<div><strong>{member.fullName || member.role}</strong><small>{member.role}</small></div></div>) : [
          { name: "Consultant principal", role: "Conseil stratégique" },
          { name: "Responsable projet", role: "Accompagnement" },
          { name: "Expert métier", role: "Expertise" },
        ].map((member) => <div key={member.name} className="pro-team-card demo-team-card"><div className="pro-demo-person"><Initials name={member.name}/></div><div><strong>{member.name}</strong><small>{member.role} · Exemple</small></div></div>)}</div></Container></section>

    <section className="pro-final-cta"><Container className="pro-final-inner"><div><span className="pro-kicker">VOTRE PROCHAINE ÉTAPE</span><h2>Vous avez un besoin ? Commençons par en parler.</h2><p>Un premier échange suffit pour comprendre votre demande et identifier la suite.</p></div><Link href={bookingHref(site)} className="pro-light-button">Demander un rendez-vous ↗</Link></Container></section>
  </div>;
}


export function DefaultBusinessHome({
  site,
  products,
  categories,
  services,
  testimonials,
}: {
  site: StorefrontSite;
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  services: ServiceSummary[];
  testimonials: TestimonialSummary[];
}) {
  const hasRealContent = products.length > 0 || categories.length > 0 || services.length > 0 || testimonials.length > 0 || Boolean(site.tenant.bannerUrl);
  const heroImage = site.heroMediaUrl ?? site.tenant.bannerUrl ?? "/images/showcase/default-hero.svg";
  const storyImage = site.tenant.bannerUrl ?? "/images/tenant-default-story.svg";
  const featuredProducts = products.slice(0, 4);
  const featuredCategories = categories.slice(0, 4);
  const featuredServices = services.slice(0, 3);
  const durationLabel = (minutes: number | null) => minutes == null ? "" : minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
  const demoProducts = [
    { name: "Sélection signature", price: "25 000 FCFA", image: "/images/tenant-default-card-1.svg", label: "Populaire" },
    { name: "Offre découverte", price: "35 000 FCFA", image: "/images/tenant-default-card-2.svg", label: "Nouveau" },
    { name: "Accompagnement premium", price: "50 000 FCFA", image: "/images/tenant-default-card-3.svg", label: "Recommandé" },
  ];
  const demoTestimonials = [
    { name: "Client satisfait", text: "Une présentation claire, des informations faciles à trouver et un échange très simple." },
    { name: "Cliente fidèle", text: "J’ai trouvé rapidement ce dont j’avais besoin et j’ai pu contacter l’entreprise directement." },
    { name: "Nouveau client", text: "Le site donne une vraie idée de l’offre avant même de prendre contact." },
  ];

  return <div className="sector-default-home">
    <section className="default-hero">
      <div className="default-hero-media"><StorefrontImage src={heroImage} alt="" priority sizes="(min-width: 1000px) 55vw, 100vw" fallbackLabel="" /></div>
      <div className="default-hero-overlay" />
      <Container className="default-hero-inner">
        <div className="default-hero-copy">
          <span className="default-kicker">{site.blueprint.eyebrow} · {site.tenant.name}</span>
          <h1>{site.config.heroTitle?.trim() || (site.tenant.name ? `Tout ce qu’il vous faut, au même endroit.` : "Une entreprise claire. Une expérience simple.")}</h1>
          <p>{site.config.heroSubtitle?.trim() || site.tenant.description || "Découvrez notre offre, nos services et les informations essentielles pour avancer simplement."}</p>
          <div className="default-actions">
            <Link href={site.capabilities.hasProducts ? STOREFRONT_PATHS.catalog : STOREFRONT_PATHS.contact} className="default-primary">{site.config.ctaLabel?.trim() || (site.capabilities.hasProducts ? "Découvrir notre offre" : "Nous contacter")} <span>→</span></Link>
            <Link href={site.capabilities.hasServices ? STOREFRONT_PATHS.services : STOREFRONT_PATHS.contact} className="default-secondary">En savoir plus</Link>
          </div>
          <div className="default-trust-row">
            {site.highlights.slice(0, 3).map((h) => <div key={h.title}><span>✓</span><strong>{h.title}<small>{h.subtitle}</small></strong></div>)}
          </div>
        </div>
        <div className="default-hero-orbit" aria-hidden><span>VOTRE MARQUE</span><span>VOTRE OFFRE</span><span>VOTRE HISTOIRE</span></div>
        <div className="default-hero-card">
          <span>{hasRealContent ? "À découvrir" : "Exemple de présentation"}</span>
          <strong>{products.length || "3"}</strong>
          <small>{products.length ? site.blueprint.catalogItemLabelPlural : "contenus présentés"}</small>
          <div className="default-mini-list"><i>01</i><span>{featuredProducts[0]?.name || "Une sélection claire"}</span><b>↗</b></div>
          <div className="default-mini-list"><i>02</i><span>{featuredServices[0]?.name || "Des services lisibles"}</span><b>↗</b></div>
        </div>
      </Container>
    </section>

    <section className="default-intro section-pad"><Container>
      <div className="default-section-head"><div><span className="default-kicker dark">L’ESSENTIEL, SANS DÉTOUR</span><h2>Une vitrine pensée pour donner envie d’aller plus loin.</h2></div><p>Le visiteur comprend rapidement qui vous êtes, ce que vous proposez et comment passer à l’action.</p></div>
      <div className="default-benefits">
        <div><span>01</span><strong>Votre offre en évidence</strong><p>Produits, prestations ou solutions trouvent naturellement leur place.</p></div>
        <div><span>02</span><strong>Une identité qui vous ressemble</strong><p>Votre logo, vos couleurs, vos images et votre ton restent au centre.</p></div>
        <div><span>03</span><strong>Un prochain pas évident</strong><p>Catalogue, contact, rendez-vous ou WhatsApp sont accessibles sans chercher.</p></div>
      </div>
    </Container></section>

    <section className="default-catalog section-pad"><Container>
      <div className="default-section-head"><div><span className="default-kicker dark">{featuredCategories.length ? "NOS CATÉGORIES" : "NOTRE OFFRE"}</span><h2>{featuredCategories.length ? "Explorez par univers." : "Découvrez ce que nous proposons."}</h2></div><Link href={STOREFRONT_PATHS.catalog} className="default-text-link">Voir le catalogue ↗</Link></div>
      {featuredCategories.length ? <div className="default-category-grid">{featuredCategories.map((category) => <Link key={category.id} href={categoryPath(category.slug)} className="default-category-card"><StorefrontImage src={category.imageUrl} alt={category.name} sizes="25vw" fallbackLabel=""/><div><span>{category.productCount} {category.productCount > 1 ? site.blueprint.catalogItemLabelPlural : site.blueprint.catalogItemLabel}</span><strong>{category.name}</strong><b>Découvrir ↗</b></div></Link>)}</div> : <div className="default-category-grid">{["Une offre principale","Solutions & prestations","Conseils & accompagnement"].map((name, i) => <Link key={name} href={STOREFRONT_PATHS.catalog} className="default-category-card default-demo-card"><div className={`default-demo-art art-${i+1}`}><span>0{i+1}</span></div><div><span>Exemple</span><strong>{name}</strong><b>Découvrir ↗</b></div></Link>)}</div>}
    </Container></section>

    <section className="default-featured section-pad"><Container>
      <div className="default-section-head"><div><span className="default-kicker dark">EN VEDETTE</span><h2>Les incontournables du moment.</h2></div><Link href={STOREFRONT_PATHS.catalog} className="default-text-link">Tout voir ↗</Link></div>
      {featuredProducts.length ? <div className="default-product-grid">{featuredProducts.map((product) => <Link key={product.id} href={product.slug ? `/produits/${product.slug}` : STOREFRONT_PATHS.catalog} className="default-product-card"><div className="default-product-media"><StorefrontImage src={product.imageUrl} alt={product.name} sizes="(min-width: 1000px) 25vw, 90vw" fallbackLabel=""/>{product.badges[0] && <span>{product.badges[0] === "promo" ? "Offre" : product.badges[0] === "new" ? "Nouveau" : product.badges[0] === "out_of_stock" ? "Indisponible" : "Sélection"}</span>}</div><div className="default-product-body"><small>{product.categoryName || site.blueprint.catalogLabel}</small><h3>{product.name}</h3><p>{product.description || "Découvrez les informations essentielles et les modalités disponibles."}</p><strong>{formatPrice(product.unitPrice)}</strong></div></Link>)}</div> : <div className="default-product-grid">{demoProducts.map((product) => <Link key={product.name} href={STOREFRONT_PATHS.catalog} className="default-product-card"><div className="default-product-media"><StorefrontImage src={product.image} alt="" sizes="(min-width: 1000px) 25vw, 90vw" fallbackLabel=""/><span>{product.label}</span></div><div className="default-product-body"><small>Exemple de contenu</small><h3>{product.name}</h3><p>Carte de démonstration : remplacez ce contenu avec vos vraies informations depuis votre tableau de bord.</p><strong>{product.price}</strong></div></Link>)}</div>}
    </Container></section>

    <section className="default-story section-pad"><Container className="default-story-grid"><div className="default-story-media"><StorefrontImage src={storyImage} alt="" sizes="(min-width: 900px) 48vw, 100vw"/><span>VOTRE HISTOIRE</span></div><div className="default-story-copy"><span className="default-kicker dark">À PROPOS</span><h2>Présentez votre entreprise avant de demander au visiteur de vous choisir.</h2><p>{site.tenant.description || "Présentez ici votre histoire, votre manière de travailler, vos engagements et ce qui rend votre entreprise différente."}</p><div className="default-story-points"><div><b>01</b><span><strong>Une identité claire</strong><small>Votre activité et votre proposition sont comprises dès les premières secondes.</small></span></div><div><b>02</b><span><strong>Une expérience fluide</strong><small>Le visiteur passe naturellement de la découverte au contact.</small></span></div><div><b>03</b><span><strong>Des informations utiles</strong><small>Horaires, localisation, catalogue et services restent accessibles.</small></span></div></div><Link href={STOREFRONT_PATHS.contact} className="default-dark-button">Découvrir l’entreprise ↗</Link></div></Container></section>

    <section className="default-services section-pad"><Container><div className="default-section-head"><div><span className="default-kicker dark">SERVICES</span><h2>Un espace pour vos prestations et votre savoir-faire.</h2></div><Link href={STOREFRONT_PATHS.services} className="default-text-link">Voir les services ↗</Link></div><div className="default-service-grid">{featuredServices.length ? featuredServices.map((service, index) => <Link key={service.id} href={`${STOREFRONT_PATHS.services}/${service.slug}`} className="default-service-card"><span>0{index+1}</span><h3>{service.name}</h3><p>{service.description || "Une prestation présentée avec les informations essentielles."}</p><strong>{formatPrice(service.price)} {service.durationMinutes ? `· ${durationLabel(service.durationMinutes)}` : ""}</strong></Link>) : ["Conseil & accompagnement","Service personnalisé","Solution sur mesure"].map((name, index) => <Link key={name} href={STOREFRONT_PATHS.contact} className="default-service-card"><span>0{index+1}</span><h3>{name}</h3><p>Exemple de prestation. Ajoutez vos propres services, descriptions, prix et durées.</p><strong>À découvrir</strong></Link>)}</div></Container></section>

    <section className="default-testimonials section-pad"><Container><div className="default-section-head"><div><span className="default-kicker dark">TÉMOIGNAGES</span><h2>Une preuve sociale qui reste crédible.</h2></div></div><div className="default-testimonial-grid">{testimonials.length ? testimonials.slice(0,3).map((t) => <figure key={t.id}><Stars rating={t.rating}/><blockquote>“{t.content}”</blockquote><figcaption><Initials name={t.authorName}/><span><strong>{t.authorName}</strong><small>Client</small></span></figcaption></figure>) : demoTestimonials.map((t) => <figure key={t.name} className="default-demo-testimonial"><Stars rating={5}/><blockquote>“{t.text}”</blockquote><figcaption><Initials name={t.name}/><span><strong>{t.name}</strong><small>Exemple de témoignage</small></span></figcaption></figure>)}</div></Container></section>

    <section className="default-final"><Container className="default-final-inner"><div><span className="default-kicker">PRÊT À ALLER PLUS LOIN ?</span><h2>Transformez la visite en conversation.</h2><p>Le visiteur a compris votre activité. Donnez-lui maintenant un moyen simple de vous contacter.</p></div><Link href={site.capabilities.hasWhatsApp ? (site.whatsappHref || STOREFRONT_PATHS.contact) : STOREFRONT_PATHS.contact} className="default-light-button">{site.capabilities.hasWhatsApp ? "Nous écrire sur WhatsApp ↗" : "Nous contacter ↗"}</Link></Container></section>
  </div>;
}

export function RestaurantHome({
  site,
  categories,
  testimonials,
}: {
  site: StorefrontSite;
  categories: StorefrontCategory[];
  testimonials: TestimonialSummary[];
}) {
  const heroImage = site.heroMediaUrl ?? site.tenant.bannerUrl ?? "/images/showcase/restaurant-hero.svg";
  const storyImage = site.tenant.bannerUrl ?? "/images/showcase/demo/restaurant-story.jpg";
  const rating = site.stats.find((s) => s.key === "rating");
  const demoCategories = [
    { name: "Plats principaux", count: "14 plats", image: "/images/showcase/demo/restaurant-1.jpg" },
    { name: "Entrées", count: "8 plats", image: "/images/showcase/demo/restaurant-2.jpg" },
    { name: "Desserts", count: "6 plats", image: "/images/showcase/demo/restaurant-3.jpg" },
    { name: "Boissons", count: "10 choix", image: "/images/showcase/demo/restaurant-4.jpg" },
  ];
  const demoTestimonials = [
    { name: "Client exemple", text: "Une belle expérience, une carte claire et une ambiance qui donne envie de revenir." },
    { name: "Cliente exemple", text: "La réservation et les informations pratiques sont faciles à trouver." },
    { name: "Habitué exemple", text: "Une adresse que l’on retrouve facilement et un menu qui donne envie." },
  ];
  return <div className="sector-restaurant-home">
    <section className="rest-hero">
      <div className="rest-hero-copy">
        <span className="rest-kicker">🍴 CUISINE LOCALE & INTERNATIONALE</span>
        <h1>{site.config.heroTitle?.trim() ? site.config.heroTitle.trim() : <>Une expérience culinaire <span className="rest-hero-accent">unique</span></>}</h1>
        <p>{site.config.heroSubtitle?.trim() || site.tenant.description || "Le goût, le partage et une cuisine généreuse dans un cadre chaleureux."}</p>
        <div className="rest-actions"><Link href={bookingHref(site)} className="rest-orange-button">Réserver une table <span>→</span></Link><Link href={STOREFRONT_PATHS.catalog} className="rest-outline-button">Découvrir notre menu <span>→</span></Link></div>
        <div className="rest-benefits">{site.highlights.slice(0,3).map((h) => <div key={h.title}><span>♡</span><strong>{h.title}<small>{h.subtitle}</small></strong></div>)}</div>
      </div>
      <div className="rest-hero-image">{heroImage && <StorefrontImage src={heroImage} alt="" priority sizes="(min-width: 900px) 55vw, 100vw" fallbackLabel=""/>}<div className="rest-hero-slogan">Bien plus qu’un repas,<br/><em>une expérience !</em></div><div className="rest-rating">{rating ? <><Stars rating={Number(rating.value) || null}/><strong>{rating.value}/5</strong><small>{rating.label}</small></> : <><strong className="rest-rating-empty">VOTRE AVIS CLIENT</strong><small>La note apparaîtra ici dès qu’elle est renseignée.</small></>}</div><div className="rest-hero-stamp"><span>CUISINE</span><strong>PASSION</strong><small>depuis toujours</small></div><div className="rest-hero-location">{locationLabel(site.tenant.address, site.tenant.name.toUpperCase())}</div></div>
    </section>

    <section className="rest-menu section-pad"><Container className="rest-menu-grid"><div className="rest-menu-intro"><span className="rest-kicker-light">NOTRE MENU</span><h2>Des saveurs pour tous les goûts</h2><p>Découvrez notre carte, nos spécialités et les informations utiles pour choisir votre prochaine expérience à table.</p><Link href={STOREFRONT_PATHS.catalog} className="rest-outline-light">Voir tout le menu →</Link></div><div className="rest-category-grid">{categories.length ? categories.slice(0,4).map((c) => <Link key={c.id} href={categoryPath(c.slug)} className="rest-category-card"><StorefrontImage src={c.imageUrl} alt={c.name} sizes="20vw" fallbackLabel=""/><div><strong>{c.name}</strong><span>{c.productCount} {c.productCount > 1 ? "plats" : "plat"}</span><em>Découvrir →</em></div></Link>) : demoCategories.map((c) => <Link key={c.name} href={STOREFRONT_PATHS.catalog} className="rest-category-card demo-rest-category"><StorefrontImage src={c.image} alt="" sizes="20vw" fallbackLabel=""/><div><strong>{c.name}</strong><span>{c.count}</span><em>Exemple →</em></div></Link>)}</div></Container></section>

    <section className="rest-story section-pad"><Container className="rest-story-grid"><div className="rest-story-media">{storyImage && <StorefrontImage src={storyImage} alt="" sizes="(min-width: 900px) 42vw, 100vw"/>}</div><div className="rest-story-copy"><span className="rest-kicker-light">À PROPOS</span><h2>Une histoire de passion et de partage</h2><p>{site.tenant.description || `${site.tenant.name} est une maison pensée pour faire voyager les papilles et créer des moments chaleureux.`}</p><ul><li>✦ Cuisine authentique et créative</li><li>✦ Cadre moderne et chaleureux</li><li>✦ Équipe passionnée et à votre écoute</li></ul><Link href={STOREFRONT_PATHS.contact} className="rest-outline-light">En savoir plus →</Link><b>Le goût<br/>du partage</b></div></Container></section>

    <section className="rest-testimonials section-pad"><Container><div className="rest-testimonial-head"><div><span className="rest-kicker-light">TÉMOIGNAGES</span><h2>Ce que nos clients disent</h2><p>Votre satisfaction est notre plus belle récompense.</p></div><span>‹ &nbsp; ›</span></div><div className="rest-testimonial-grid">{testimonials.length ? testimonials.slice(0,3).map((t) => <figure key={t.id}><Initials name={t.authorName}/><blockquote>« {t.content} »</blockquote><figcaption><strong>{t.authorName}</strong><Stars rating={t.rating}/></figcaption></figure>) : demoTestimonials.map((t) => <figure key={t.name} className="demo-testimonial"><Initials name={t.name}/><blockquote>« {t.text} »</blockquote><figcaption><strong>{t.name}</strong><small>Exemple de témoignage</small></figcaption></figure>)}</div></Container></section>
  </div>;
}
