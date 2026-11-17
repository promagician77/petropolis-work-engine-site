// Request signing checks. Web Crypto, so the same code runs in Lambda (Node 22) and the browser.

const enc = new TextEncoder();

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare, so timing does not leak how much of a signature matched. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Slack's recipe: v0=HMAC_SHA256(signing_secret, "v0:" + timestamp + ":" + raw_body),
 * and reject timestamps more than 5 minutes from now to stop replays.
 */
export async function verifySlackRequest({ signingSecret, timestamp, rawBody, signature, nowSec, toleranceSec = 300 }) {
  if (!signingSecret || !timestamp || !signature || rawBody == null) return { ok: false, reason: 'missing_headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - ts) > toleranceSec) return { ok: false, reason: 'stale_timestamp' };
  const expected = `v0=${await hmacSha256Hex(signingSecret, `v0:${timestamp}:${rawBody}`)}`;
  return safeEqual(expected, signature) ? { ok: true, reason: 'ok' } : { ok: false, reason: 'bad_signature' };
}

/** Slack's own published example (docs: "Verifying requests from Slack"). Used as a test vector. */
export const SLACK_EXAMPLE = {
  signingSecret: '8f742231b10e8888abcd99yyyzzz85a5',
  timestamp: '1531420618',
  rawBody: 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c',
  signature: 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
};
