import Link from "next/link";
import type { ReactNode } from "react";
import type { Block } from "@/domain/entities/site";
import { Container } from "./storefront-ui";
import { StorefrontImage } from "./storefront-image";

/**
 * Rendu des blocs riches du site libre. Composants PRÉSENTATIONNELS purs : tout le contenu est du texte brut
 * rendu par React (échappé), les liens sont déjà validés par le schéma (chemin « /… » ou https), les images
 * https. Aucun `dangerouslySetInnerHTML`, aucun script — un test d'architecture le vérifie.
 */
type Rich<T extends Block["type"]> = Extract<Block, { type: T }>["props"];
type Style = { background?: "default" | "soft" | "brand" | "dark"; align?: "left" | "center"; spacing?: "compact" | "normal" | "spacious" };

const PAD = { compact: "py-6 sm:py-8", normal: "py-10 sm:py-14", spacious: "py-16 sm:py-24" } as const;

function tone(style: Style) {
  const bg = style.background ?? "default";
  const dark = bg === "brand" || bg === "dark";
  return {
    section: `${PAD[style.spacing ?? "normal"]} ${bg === "soft" ? "sf-section-muted" : bg === "brand" ? "sf-section-brand" : bg === "dark" ? "bg-slate-900 text-white" : ""}`,
    center: style.align === "center",
    dark,
    sub: dark ? "text-white/75" : "text-black/60",
    card: dark ? "border-white/15 bg-white/5" : "border-black/10 bg-white",
  };
}

function Wrap({ style, children, id }: { style: Style; children: ReactNode; id?: string }) {
  const t = tone(style);
  return (
    <section id={id} className={t.section}>
      <Container>{children}</Container>
    </section>
  );
}

function Heading({ eyebrow, heading, subtitle, style }: { eyebrow?: string; heading?: string; subtitle?: string; style: Style }) {
  if (!eyebrow && !heading && !subtitle) return null;
  const t = tone(style);
  return (
    <div className={`mb-8 max-w-3xl ${t.center ? "mx-auto text-center" : ""}`}>
      {eyebrow && <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${t.dark ? "text-white/80" : "text-brand"}`}>{eyebrow}</p>}
      {heading && <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">{heading}</h2>}
      {subtitle && <p className={`mt-2 text-base leading-7 ${t.sub}`}>{subtitle}</p>}
    </div>
  );
}

/** Lien du site (`/…`) ou externe (https). */
function ButtonLink({ href, label, kind }: { href: string; label: string; kind: "primary" | "outline" }) {
  const cls = kind === "primary" ? "sf-btn-primary" : "sf-btn-outline";
  return href.startsWith("/") ? (
    <Link href={href} className={cls}>{label}</Link>
  ) : (
    <a href={href} className={cls} rel="noopener noreferrer nofollow">{label}</a>
  );
}

const COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" } as const;

export function RichHero({ p }: { p: Rich<"rich_hero"> }) {
  const t = tone({ background: p.background ?? "soft", align: p.align, spacing: p.spacing ?? "spacious" });
  const layout = p.layout ?? (p.mediaUrl ? "split" : "centered");
  const center = layout === "centered" || t.center;
  return (
    <section className={`${t.section} sf-hero`}>
      <Container>
        <div className={layout === "split" && p.mediaUrl ? "grid items-center gap-10 lg:grid-cols-2" : ""}>
          <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-2xl"}>
            {p.eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{p.eyebrow}</p>}
            <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{p.title}</h1>
            {p.subtitle && <p className={`mt-4 text-lg leading-8 ${t.sub}`}>{p.subtitle}</p>}
            {(p.primaryCta || p.secondaryCta) && (
              <div className={`mt-6 flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}>
                {p.primaryCta && <ButtonLink href={p.primaryCta.href} label={p.primaryCta.label} kind="primary" />}
                {p.secondaryCta && <ButtonLink href={p.secondaryCta.href} label={p.secondaryCta.label} kind="outline" />}
              </div>
            )}
          </div>
          {p.mediaUrl && (
            <div className={`relative overflow-hidden rounded-brand ${layout === "split" ? "aspect-[4/3]" : "mx-auto mt-10 aspect-[16/7] max-w-5xl"}`}>
              <StorefrontImage src={p.mediaUrl} alt={p.mediaAlt ?? ""} priority sizes="(min-width: 1024px) 50vw, 100vw" />
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}

export function RichText({ p }: { p: Rich<"rich_text"> }) {
  const t = tone(p);
  return (
    <Wrap style={p}>
      <div className={`max-w-3xl ${t.center ? "mx-auto text-center" : ""}`}>
        {p.eyebrow && <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${t.dark ? "text-white/80" : "text-brand"}`}>{p.eyebrow}</p>}
        {p.heading && <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">{p.heading}</h2>}
        <p className={`${p.heading ? "mt-3" : ""} whitespace-pre-line text-base leading-8 ${t.dark ? "text-white/85" : "text-black/70"}`}>{p.body}</p>
      </div>
    </Wrap>
  );
}

export function FeatureGrid({ p }: { p: Rich<"feature_grid"> }) {
  const t = tone(p);
  return (
    <Wrap style={p}>
      <Heading heading={p.heading} subtitle={p.subtitle} style={p} />
      <ul className={`grid gap-4 ${COLS[p.columns ?? 3]}`}>
        {p.items.map((item, i) => (
          <li key={i} className={`rounded-brand border p-5 ${t.card}`}>
            {item.icon && <span aria-hidden className="sf-icon-box mb-3 inline-flex h-10 w-10 items-center justify-center rounded-brand text-xl">{item.icon}</span>}
            <h3 className="font-display text-base font-semibold">{item.title}</h3>
            {item.text && <p className={`mt-1.5 text-sm leading-6 ${t.sub}`}>{item.text}</p>}
          </li>
        ))}
      </ul>
    </Wrap>
  );
}

export function ImageText({ p }: { p: Rich<"image_text"> }) {
  const t = tone(p);
  const right = p.imageSide === "right";
  return (
    <Wrap style={p}>
      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <div className={`relative aspect-[4/3] overflow-hidden rounded-brand ${right ? "lg:order-2" : ""}`}>
          <StorefrontImage src={p.mediaUrl} alt={p.mediaAlt} sizes="(min-width: 1024px) 50vw, 100vw" />
        </div>
        <div>
          {p.heading && <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{p.heading}</h2>}
          <p className={`${p.heading ? "mt-3" : ""} whitespace-pre-line text-base leading-8 ${t.dark ? "text-white/85" : "text-black/70"}`}>{p.body}</p>
          {p.cta && <div className="mt-5"><ButtonLink href={p.cta.href} label={p.cta.label} kind="primary" /></div>}
        </div>
      </div>
    </Wrap>
  );
}

export function Steps({ p }: { p: Rich<"steps"> }) {
  const t = tone(p);
  return (
    <Wrap style={p}>
      <Heading heading={p.heading} subtitle={p.subtitle} style={p} />
      <ol className={`grid gap-5 ${p.items.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
        {p.items.map((item, i) => (
          <li key={i} className={`rounded-brand border p-5 ${t.card}`}>
            <span className="sf-icon-box inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold">{i + 1}</span>
            <h3 className="mt-3 font-display text-base font-semibold">{item.title}</h3>
            {item.text && <p className={`mt-1.5 text-sm leading-6 ${t.sub}`}>{item.text}</p>}
          </li>
        ))}
      </ol>
    </Wrap>
  );
}

export function Stats({ p }: { p: Rich<"stats"> }) {
  const t = tone(p);
  return (
    <Wrap style={{ ...p, align: p.align ?? "center" }}>
      <Heading heading={p.heading} style={{ ...p, align: "center" }} />
      <dl className="grid grid-cols-2 gap-6 text-center lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {p.items.map((item, i) => (
          <div key={i}>
            <dt className={`order-2 mt-1 text-sm ${t.sub}`}>{item.label}</dt>
            <dd className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Wrap>
  );
}

export function Pricing({ p }: { p: Rich<"pricing"> }) {
  const t = tone(p);
  return (
    <Wrap style={p}>
      <Heading heading={p.heading} subtitle={p.subtitle} style={p} />
      <div className={`grid gap-5 ${p.plans.length === 1 ? "max-w-md" : p.plans.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"} ${p.plans.length === 4 ? "lg:grid-cols-4" : ""}`}>
        {p.plans.map((plan, i) => (
          <div key={i} className={`flex flex-col rounded-brand border p-6 ${plan.highlighted ? "border-brand ring-2 ring-[var(--brand-primary,#0f172a)]" : t.card}`}>
            <h3 className="font-display text-lg font-bold">{plan.name}</h3>
            <p className="mt-2"><span className="font-display text-3xl font-extrabold">{plan.price}</span>{plan.period && <span className={`ml-1 text-sm ${t.sub}`}>{plan.period}</span>}</p>
            {plan.description && <p className={`mt-2 text-sm ${t.sub}`}>{plan.description}</p>}
            {plan.features.length > 0 && (
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {plan.features.map((f, j) => <li key={j} className="flex gap-2"><span aria-hidden>✓</span><span>{f}</span></li>)}
              </ul>
            )}
            {plan.cta && <div className="mt-6"><ButtonLink href={plan.cta.href} label={plan.cta.label} kind={plan.highlighted ? "primary" : "outline"} /></div>}
          </div>
        ))}
      </div>
    </Wrap>
  );
}

export function Quotes({ p }: { p: Rich<"quotes"> }) {
  const t = tone(p);
  return (
    <Wrap style={p}>
      <Heading heading={p.heading} style={p} />
      <div className={`grid gap-5 ${p.items.length === 1 ? "max-w-2xl" : "md:grid-cols-2 lg:grid-cols-3"}`}>
        {p.items.map((item, i) => (
          <figure key={i} className={`rounded-brand border p-5 ${t.card}`}>
            <blockquote className="text-base leading-7">« {item.quote} »</blockquote>
            <figcaption className={`mt-3 text-sm ${t.sub}`}><span className="font-semibold">{item.author}</span>{item.role && <> — {item.role}</>}</figcaption>
          </figure>
        ))}
      </div>
    </Wrap>
  );
}

export function CtaBand({ p }: { p: Rich<"cta_band"> }) {
  const style: Style = { ...p, background: p.background ?? "brand", align: p.align ?? "center" };
  const t = tone(style);
  return (
    <Wrap style={style}>
      <div className={`max-w-3xl ${t.center ? "mx-auto text-center" : ""}`}>
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{p.heading}</h2>
        {p.text && <p className={`mt-3 text-base leading-7 ${t.sub}`}>{p.text}</p>}
        <div className={`mt-6 flex flex-wrap gap-3 ${t.center ? "justify-center" : ""}`}>
          <ButtonLink href={p.cta.href} label={p.cta.label} kind={t.dark ? "outline" : "primary"} />
          {p.secondaryCta && <ButtonLink href={p.secondaryCta.href} label={p.secondaryCta.label} kind="outline" />}
        </div>
      </div>
    </Wrap>
  );
}

export function FaqList({ p }: { p: Rich<"faq_list"> }) {
  const t = tone(p);
  return (
    <Wrap style={p}>
      <Heading heading={p.heading} style={p} />
      <div className="max-w-3xl space-y-3">
        {p.items.map((item, i) => (
          <details key={i} className={`group rounded-brand border p-4 ${t.card}`}>
            <summary className="cursor-pointer list-none font-semibold">{item.question}</summary>
            <p className={`mt-2 whitespace-pre-line text-sm leading-7 ${t.sub}`}>{item.answer}</p>
          </details>
        ))}
      </div>
    </Wrap>
  );
}

export function ImageGallery({ p }: { p: Rich<"image_gallery"> }) {
  return (
    <Wrap style={p}>
      <Heading heading={p.heading} style={p} />
      <ul className={`grid grid-cols-2 gap-3 ${COLS[p.columns ?? 3].replace("sm:grid-cols-2 ", "")}`}>
        {p.images.map((img, i) => (
          <li key={i}>
            <div className="relative aspect-square overflow-hidden rounded-brand"><StorefrontImage src={img.url} alt={img.alt} /></div>
            {img.caption && <p className="mt-1.5 text-xs text-black/60">{img.caption}</p>}
          </li>
        ))}
      </ul>
    </Wrap>
  );
}

export function Divider({ p }: { p: Rich<"divider"> }) {
  return <Container className={PAD[p.spacing ?? "compact"]}><hr className="border-black/10" /></Container>;
}

/** Rend un bloc riche ; `null` pour tout autre type (sections de données, gérées par `block-page.tsx`). */
export function renderRichBlock(block: Block): ReactNode {
  switch (block.type) {
    case "rich_hero": return <RichHero key={block.id} p={block.props} />;
    case "rich_text": return <RichText key={block.id} p={block.props} />;
    case "feature_grid": return <FeatureGrid key={block.id} p={block.props} />;
    case "image_text": return <ImageText key={block.id} p={block.props} />;
    case "steps": return <Steps key={block.id} p={block.props} />;
    case "stats": return <Stats key={block.id} p={block.props} />;
    case "pricing": return <Pricing key={block.id} p={block.props} />;
    case "quotes": return <Quotes key={block.id} p={block.props} />;
    case "cta_band": return <CtaBand key={block.id} p={block.props} />;
    case "faq_list": return <FaqList key={block.id} p={block.props} />;
    case "image_gallery": return <ImageGallery key={block.id} p={block.props} />;
    case "divider": return <Divider key={block.id} p={block.props} />;
    default: return null;
  }
}
