/**
 * EmbeddingPort — port métier des embeddings (P6). Les services n'appellent
 * jamais un SDK : seul `src/infrastructure/providers/embedding/*` connaît un
 * fournisseur concret. La dimension est une propriété du modèle : un vecteur
 * de mauvaise taille est REFUSÉ par l'adaptateur (jamais stocké).
 */
export interface EmbeddingPort {
  readonly providerName: string;
  readonly model: string;
  readonly dimensions: number;
  /** Un vecteur par texte, dans l'ordre. Ne journalise jamais les textes. */
  embed(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
}
