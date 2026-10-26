import { createTaskService, type TaskService } from "@/application/agents/task-service";
import { createSupabaseTaskRepository } from "./supabase-task-repository";

let service: TaskService | null = null;
/** Création différée : Supabase n'est chargé qu'à la première utilisation d'un outil de tâche. */
export function getTaskService(): TaskService {
  return (service ??= createTaskService({ repo: createSupabaseTaskRepository() }));
}
