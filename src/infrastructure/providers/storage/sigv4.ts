import { createHash, createHmac } from "node:crypto";

/**
 * Signature AWS Signature V4 minimale pour l'API S3-compatible de
 * Cloudflare R2 (C4, livrable F).
 *
 * Choix : pas de dépendance `@aws-sdk/client-s3` (≈ 100 paquets pour
 * 3 opérations : PUT, DELETE, HEAD). Ce module n'utilise que `node:crypto`
 * et `fetch`, et est vérifié contre le vecteur de test officiel AWS
 * (voir sigv4.test.ts). Si le besoin grandit (multipart, URLs présignées
 * côté navigateur), remplacer par le SDK officiel derrière le même port.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4Request {
  method: string;
  /** URL absolue (path-style pour R2 : https://<compte>.r2.cloudflarestorage.com/<bucket>/<clé>). */
  url: string;
  /** En-têtes à signer (hors host, x-amz-date et x-amz-content-sha256, ajoutés ici). */
  headers?: Record<string, string>;
  body?: Uint8Array | Buffer;
  region: string;
  service: string;
  /** Injectable pour les tests ; défaut : maintenant. */
  now?: Date;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Encodage RFC 3986 strict, exigé par SigV4 (encodeURIComponent laisse passer ! ' ( ) *). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(pathname: string): string {
  // S3 : un seul niveau d'encodage, les "/" sont conservés.
  return pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Retourne les en-têtes complets (dont Authorization) à passer à `fetch`. */
export function signRequestV4(request: SigV4Request, credentials: SigV4Credentials): Record<string, string> {
  const url = new URL(request.url);
  const now = request.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(request.body ?? "");

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  headers["host"] = url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, request.region);
  const kService = hmac(kRegion, request.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}
