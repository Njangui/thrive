import type { GalleryImage } from "@/application/services/landing-config-service";

export function GallerySection({ images }: { images: GalleryImage[] }) {
  if (images.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Galerie</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {images.map((image, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${image.url}-${index}`}
            src={image.url}
            alt={image.productName}
            className="aspect-square w-full rounded-lg border border-ink/10 object-cover"
          />
        ))}
      </div>
    </section>
  );
}
