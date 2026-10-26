/**
 * Exposition des outils au LLM : noms compatibles fournisseurs et JSON Schema
 * dérivé du schéma Zod de l'outil (une seule source de vérité : le même Zod
 * valide ensuite l'appel côté serveur).
 */
import { z } from "zod";
import type { AIToolSpec } from "@/domain/ports/ai-provider";
import type { ToolDef } from "./contracts";
import { AgentError } from "./errors";

const LLM_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** `catalog.update_price` -> `catalog__update_price` (les « . » sont refusés par les API). */
export function toLlmName(internalName: string): string {
  const encoded = internalName.replace(".", "__");
  if (!LLM_NAME.test(encoded)) throw new AgentError("registry_invalid", `Nom non exposable au LLM : ${internalName}`);
  return encoded;
}

export function fromLlmName(llmName: string): string {
  return llmName.replace("__", ".");
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  if (rest.type !== "object") throw new AgentError("registry_invalid", "Le schéma d'entrée d'un outil doit être un objet");
  return rest;
}

export function toolSpec(tool: Pick<ToolDef<unknown, unknown>, "name" | "description" | "input">): AIToolSpec {
  return { name: toLlmName(tool.name), description: tool.description, parameters: jsonSchemaOf(tool.input as z.ZodType) };
}
