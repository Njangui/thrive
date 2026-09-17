import type { TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { IconStar } from "../storefront/storefront-icons";
import { Section, SectionHeading } from "../storefront/storefront-ui";

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`Note : ${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <IconStar
          key={index}
          className={`h-4 w-4 ${index <= rating ? "fill-current text-brand" : "text-black/15"}`}
        />
      ))}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TestimonialsSection({
  testimonials,
  site,
}: {
  testimonials: TestimonialSummary[];
  site: StorefrontSite;
}) {
  if (testimonials.length === 0) return null;

  return (
    <Section tone="muted">
      <SectionHeading title={sectionHeading(site.blueprint, "testimonials", "Ce qu'en disent nos clients")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((testimonial) => (
          <figure
            key={testimonial.id}
            className="sf-card flex h-full flex-col gap-3 rounded-brand border border-black/[0.08] bg-white p-5"
          >
            {testimonial.rating != null && <Stars rating={testimonial.rating} />}
            <blockquote className="flex-1 text-sm leading-6 text-black/70">« {testimonial.content} »</blockquote>
            <figcaption className="flex items-center gap-3 border-t border-black/[0.06] pt-3">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft-strong,rgba(0,0,0,.06))] font-display text-xs font-bold text-brand"
              >
                {initials(testimonial.authorName)}
              </span>
              <span className="text-sm font-semibold">{testimonial.authorName}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}
