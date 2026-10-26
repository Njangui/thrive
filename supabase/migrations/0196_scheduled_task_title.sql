-- Étape 5 : tâches planifiées créées depuis le chat. Un titre lisible pour la liste et la livraison du résultat.
alter table scheduled_tasks add column if not exists title text
  check (title is null or char_length(title) between 1 and 80);
