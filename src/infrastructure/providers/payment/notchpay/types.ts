/**
 * Types NotchPay — CONFIRMÉS via developer.notchpay.co (consulté 31 août
 * 2026 : /api-reference/payments, /get-started/webhooks). Voir
 * docs/PAYMENT_INTEGRATION.md pour le verdict complet
 * SUPPORTED/PARTIAL/NOT_SUPPORTED par capacité.
 */

export type NotchPayPaymentStatus =
  | "pending"
  | "processing"
  | "complete"
  | "failed"
  | "canceled"
  | "expired";

export interface NotchPayCreatePaymentPayload {
  amount: number;
  currency: string; // 'XAF' pour ce projet
  email?: string;
  phone?: string;
  description?: string;
  reference: string; // fourni par l'appelant — jamais généré par NotchPay
  callback?: string;
}

export interface NotchPayTransaction {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: NotchPayPaymentStatus;
  customer?: string;
  created_at: string;
  completed_at?: string;
}

export interface NotchPayCreatePaymentResponse {
  status: string;
  message: string;
  code: number;
  transaction: NotchPayTransaction;
  authorization_url: string;
}

export interface NotchPayRetrievePaymentResponse {
  status: string;
  message: string;
  code: number;
  transaction: NotchPayTransaction;
}

export interface NotchPayCancelPaymentResponse {
  code: number;
  status: string;
  message: string;
}

/**
 * Corps du webhook — CONFIRMÉ (un seul objet par delivery, pas de batch,
 * contrairement à Zernio où on normalise vers un tableau par prudence ;
 * ici la doc ne montre qu'un objet unique donc on ne normalise pas).
 * Events confirmés : payment.created, payment.complete, payment.failed,
 * payment.canceled, payment.expired. Aucun event "payment.refunded"
 * documenté — voir docs/PAYMENT_INTEGRATION.md, remboursement =
 * NOT_SUPPORTED via API.
 */
export interface NotchPayWebhookEvent {
  id: string;
  event:
    | "payment.created"
    | "payment.complete"
    | "payment.failed"
    | "payment.canceled"
    | "payment.expired"
    | string;
  data: {
    amount: number;
    amount_total?: number;
    sandbox?: boolean;
    fee?: number;
    converted_amount?: number;
    payment_method?: string;
    customer?: string;
    reference: string;
    provider_reference?: string | null;
    status: NotchPayPaymentStatus;
    currency: string;
    geo?: string;
    created_at: string;
    updated_at: string;
  };
}

/**
 * Resources API — Country Engine (section 8 du master prompt
 * d'expansion multi-pays). CONFIRMÉ via developer.notchpay.co/
 * api-reference/resources (consulté 06/09/2026 — voir
 * docs/notchpay-resources.md pour le détail complet des réponses
 * réelles). Distinct de `GET /countries` (sans préfixe /resources),
 * qui liste TOUS les pays du monde ({name, code} uniquement, sans
 * devise/indicatif) pour des formulaires génériques — PAS la même
 * ressource, et PAS utilisée ici : seule `/resources/countries`
 * reflète ce que NotchPay supporte réellement comme moyen de paiement,
 * ce qui est la question posée par le Country Engine.
 */
export interface NotchPayResourceCountry {
  code: string; // ISO 3166-1 alpha-2, ex: 'CM'
  name: string;
  currency: string; // ISO 4217, ex: 'XAF'
  flag?: string; // URL d'image (ex: https://assets.notchpay.co/flags/cm.png) — PAS un emoji
  phone_code: string; // ex: '+237'
  channels?: string[]; // catégories larges, ex: ['mobile_money', 'card', 'bank'] — PAS les channel_code individuels (voir NotchPayResourceChannel)
}

export interface NotchPayListCountriesResponse {
  code: number;
  status: string;
  message: string;
  countries: NotchPayResourceCountry[];
}

export interface NotchPayGetCountryResponse {
  code: number;
  status: string;
  message: string;
  country: NotchPayResourceCountry & {
    available_channels?: Array<{ id: string; name: string; type: string }>;
  };
}

export interface NotchPayResourceChannel {
  id: string; // ex: 'cm.mtn'
  name: string;
  country: string; // ISO 3166-1 alpha-2
  currency: string;
  type: string; // 'mobile_money' | 'bank' | 'ussd' | 'qr' | 'wallet' — catalogue NotchPay évolutif, texte libre côté nous aussi (voir 0040_country_engine.sql)
  logo?: string;
  minimum?: number;
  maximum?: number;
}

export interface NotchPayListChannelsResponse {
  code: number;
  status: string;
  message: string;
  channels: NotchPayResourceChannel[];
}
