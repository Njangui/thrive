import type { TestimonialSummary } from "@/application/services/landing-config-service";

function Stars({ rating }: { rating: number }) {
  return (
    <div aria-label={`Note : ${rating} sur 5`} className="text-brand">
      {"★".repeat(rating)}
      <span className="text-ink/15">{"★".repeat(5 - rating)}</span>
    </div>
  );
}

export function TestimonialsSection({ testimonials }: { testimonials: TestimonialSummary[] }) {
  if (testimonials.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Ce qu&apos;en disent nos clients</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {testimonials.map((testimonial) => (
          <figure key={testimonial.id} className="flex flex-col gap-2 rounded-lg border border-ink/10 bg-white p-4">
            {testimonial.rating && <Stars rating={testimonial.rating} />}
            <blockquote className="text-sm text-ink/80">« {testimonial.content} »</blockquote>
            <figcaption className="text-xs font-medium text-muted">— {testimonial.authorName}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
