"use client";

import { useState } from "react";
import { MIcon } from "./marketing-icons";

const FAQ_ITEMS = [
  {
    question: "Ai-je besoin d'une carte bancaire pour essayer ?",
    answer: "Non. Le plan Starter est gratuit et ne demande aucune carte bancaire pour commencer.",
  },
  {
    question: "Sur quels canaux puis-je vendre et communiquer ?",
    answer:
      "WhatsApp est le canal principal. Selon votre plan, vous pouvez aussi publier vos produits sur Facebook, Instagram, TikTok, LinkedIn et d'autres réseaux sociaux.",
  },
  {
    question: "L'assistant IA répond-il vraiment à ma place ?",
    answer:
      "Il répond aux questions courantes (horaires, disponibilité, prix) à partir de votre catalogue et de votre FAQ, et vous transfère la conversation dès qu'un client a une demande qui sort de ce cadre.",
  },
  {
    question: "Puis-je changer de plan ou annuler à tout moment ?",
    answer: "Oui, il n'y a pas d'engagement : vous pouvez changer de plan ou annuler quand vous le souhaitez.",
  },
  {
    question: "Combien de temps prend la mise en route ?",
    answer:
      "Quelques minutes : vous créez votre compte, ajoutez vos premiers produits et connectez votre WhatsApp — pas de configuration technique requise.",
  },
];

export function MarketingFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mx-auto mt-10 max-w-2xl divide-y divide-ink/10 rounded-2xl border border-ink/5 bg-white shadow-sm">
      {FAQ_ITEMS.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-medium text-ink">{item.question}</span>
              <MIcon
                name="chevronDown"
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
            {open && <p className="px-5 pb-4 text-sm text-muted">{item.answer}</p>}
          </div>
        );
      })}
    </div>
  );
}
