// Android alerts straight through Firebase Cloud Messaging HTTP v1, no Expo push service. The engine mints an OAuth2
// access token from the Firebase service account (JWT RS256, scope firebase.messaging), caches it until shortly before
// it expires, and sends one data message per device token. The message carries only the sealed Mirror envelope and
// the generic "Mirror / New activity" text that expo-notifications shows (data.title / data.message / data.channelId).
//
// The service account key is a secret: it is read at runtime from FCM_SERVICE_ACCOUNT_PATH (a file outside the repo)
// or FCM_SERVICE_ACCOUNT_JSON (hosting), never logged, and only its client_email / project_id are ever reported.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PushEnvelope } from './pushcrypto.js';

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
/** Native FCM registration tokens (about 160 characters today). */
export const FCM_TOKEN = /^[A-Za-z0-9_:.\-]{32,512}$/;

export interface ServiceAccount { client_email: string; private_key: string; project_id: string }

/** Parses and checks a service account JSON. Error messages never include the key material. */
export function parseServiceAccount(raw: string): ServiceAccount {
  let j: Partial<ServiceAccount> & { type?: string };
  try {
    j = JSON.parse(raw) as typeof j;
  } catch {
    throw new Error('FCM service account is not valid JSON');
  }
  if (typeof j.client_email !== 'string' || typeof j.private_key !== 'string' || !j.private_key.includes('PRIVATE KEY') || typeof j.project_id !== 'string') {
    throw new Error('FCM service account must hold client_email, private_key and project_id');
  }
  return { client_email: j.client_email, private_key: j.private_key, project_id: j.project_id };
}

/** FCM_SERVICE_ACCOUNT_JSON wins over FCM_SERVICE_ACCOUNT_PATH; undefined when neither is set. */
export function loadServiceAccount(env: { FCM_SERVICE_ACCOUNT_JSON?: string; FCM_SERVICE_ACCOUNT_PATH?: string }): ServiceAccount | undefined {
  if (env.FCM_SERVICE_ACCOUNT_JSON) return parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  if (!env.FCM_SERVICE_ACCOUNT_PATH) return undefined;
  let raw: string;
  try {
    raw = readFileSync(env.FCM_SERVICE_ACCOUNT_PATH, 'utf8');
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_PATH is not readable');
  }
  return parseServiceAccount(raw);
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The signed JWT assertion for Google's token endpoint (RFC 7523). */
export function serviceAccountJwt(sa: ServiceAccount, nowSec: number, aud = GOOGLE_TOKEN_URL): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: FCM_SCOPE, aud, iat: nowSec, exp: nowSec + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key);
  return `${head}.${claims}.${b64url(sig)}`;
}

export interface FcmOptions {
  serviceAccount: ServiceAccount;
  /** Project id for the send URL; defaults to the service account's. */
  projectId?: string;
  /** Test hook (localnet only): send URL; the token is then minted at <origin>/token of the same server. */
  endpointOverride?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type FcmResult = { ok: true } | { ok: false; status: number; code: string; gone: boolean };

export class FcmSender {
  private token: { value: string; expiresMs: number } | null = null;
  private minting: Promise<string> | null = null;
  readonly sendUrl: string;
  readonly projectId: string;
  readonly tokenUrl: string;

  constructor(private readonly o: FcmOptions) {
    this.projectId = o.projectId ?? o.serviceAccount.project_id;
    this.sendUrl = o.endpointOverride ?? fcmSendUrl(this.projectId);
    this.tokenUrl = o.endpointOverride ? new URL('/token', o.endpointOverride).toString() : GOOGLE_TOKEN_URL;
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }
  private get fetch() {
    return this.o.fetchImpl ?? fetch;
  }

  /** Cached until a minute before expiry; concurrent callers share one mint. */
  async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresMs - 60_000) return this.token.value;
    this.minting ??= this.mint().finally(() => (this.minting = null));
    return this.minting;
  }

  private async mint(): Promise<string> {
    const assertion = serviceAccountJwt(this.o.serviceAccount, Math.floor(this.now() / 1000), GOOGLE_TOKEN_URL);
    const res = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !j.access_token) throw new Error(`FCM token mint failed: HTTP ${res.status}`);
    this.token = { value: j.access_token, expiresMs: this.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  /** One data message. UNREGISTERED / 404 means the token is gone for good (the caller deletes it). */
  async send(deviceToken: string, env: PushEnvelope, generic: { title: string; body: string }, channelId: string): Promise<FcmResult> {
    const mirror = JSON.stringify(env);
    const message = {
      token: deviceToken,
      // expo-notifications presents a data message from data.title / data.message on data.channelId; data.body is the
      // JSON it hands to JS as content.data. data.mirror is what the background task reads.
      data: { title: generic.title, message: generic.body, channelId, mirror, body: JSON.stringify({ mirror }) },
      android: { priority: 'HIGH', ttl: '3600s' },
    };
    const send = async () =>
      this.fetch(this.sendUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken()}` },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(10_000),
      });
    let res = await send();
    if (res.status === 401) {
      this.token = null; // revoked or rotated: mint once more
      res = await send();
    }
    if (res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      return { ok: true };
    }
    const j = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } };
    const code = j.error?.details?.find((d) => d.errorCode)?.errorCode ?? j.error?.status ?? `HTTP_${res.status}`;
    return { ok: false, status: res.status, code, gone: code === 'UNREGISTERED' || res.status === 404 };
  }
}

/** The sender for the engine's env, or undefined when no service account is configured. */
export function fcmFromEnv(env: { NETWORK: string; FCM_SERVICE_ACCOUNT_JSON?: string; FCM_SERVICE_ACCOUNT_PATH?: string; FCM_PROJECT_ID?: string; FCM_ENDPOINT_OVERRIDE?: string }, fetchImpl?: typeof fetch): FcmSender | undefined {
  if (env.FCM_ENDPOINT_OVERRIDE && env.NETWORK !== 'localnet') throw new Error('FCM_ENDPOINT_OVERRIDE is only allowed with NETWORK=localnet');
  const serviceAccount = loadServiceAccount(env);
  return serviceAccount ? new FcmSender({ serviceAccount, projectId: env.FCM_PROJECT_ID, endpointOverride: env.FCM_ENDPOINT_OVERRIDE, fetchImpl }) : undefined;
}
