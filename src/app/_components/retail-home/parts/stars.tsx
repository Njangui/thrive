import { IconStar } from "../../storefront/storefront-icons";

/** Cinq étoiles pleines/vides ; rien du tout sans note réelle (jamais un « 5/5 » par défaut). */
export function Stars({ rating }: { rating: number | null }) {
  if (rating == null || rating <= 0) return null;
  const rounded = Math.round(rating);
  return (
    <span className="rt-stars" role="img" aria-label={`Note : ${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <IconStar key={index} className={index <= rounded ? "rt-star rt-star--on" : "rt-star"} />
      ))}
    </span>
  );
}
