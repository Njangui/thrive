"use client";

import { useRef } from "react";
import { trackVideoPlayAction } from "../track-visit-actions";

/**
 * Lecteur vidéo de la vitrine publique (fiche produit, page d'accueil).
 *
 * `preload="metadata"` : le navigateur ne télécharge que la durée et la
 * première image — pas la vidéo entière — tant que le visiteur n'appuie pas
 * sur lecture (économise la bande passante mobile, importante pour une
 * clientèle qui navigue surtout en 3G/4G).
 *
 * La première lecture d'une vidéo est comptée UNE fois par affichage de
 * page pour l'analytique de la vitrine (voir landing-analytics-service.ts).
 */
export function StorefrontVideo({
  videoId,
  src,
  title,
  className = "",
}: {
  videoId: string;
  src: string;
  title: string;
  className?: string;
}) {
  const counted = useRef(false);

  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label={title}
      className={`aspect-video w-full rounded-brand border border-black/[0.08] bg-black ${className}`}
      onPlay={() => {
        if (counted.current) return;
        counted.current = true;
        void trackVideoPlayAction(videoId);
      }}
    />
  );
}
