const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

const LIMITS = {
  bodyBytes: 8_192,
  ipPerMinute: 20,
  ipPerHour: 180,
  fingerprintPerMinute: 12,
  samePayloadPerTenMinutes: 8,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return corsResponse(request, env, null, 204);
    }

    if (url.pathname !== "/api/estimate") {
      return json(request, env, { ok: false, error: "not_found" }, 404);
    }

    if (request.method !== "POST") {
      return json(request, env, { ok: false, error: "method_not_allowed" }, 405);
    }

    const decision = await inspectEstimateRequest(request, env);
    if (!decision.allow) {
      ctx.waitUntil(logBlocked(request, decision));
      return json(request, env, { ok: false, error: "request_blocked" }, decision.status);
    }

    if (env.ORIGIN_ESTIMATE_URL) {
      return proxyEstimate(request, env, decision.body);
    }

    return json(request, env, {
      ok: true,
      requestId: decision.requestId,
      estimate: null,
      message: "Estimate engine is not connected yet.",
    });
  },
};

async function inspectEstimateRequest(request, env) {
  const requestId = crypto.randomUUID();
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  const ua = request.headers.get("user-agent") || "";
  const origin = request.headers.get("origin") || "";
  const acceptLanguage = request.headers.get("accept-language") || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  const fingerprint = await sha256(`${ip}|${ua.slice(0, 180)}`);

  const reasons = [];
  let score = 0;

  if (!isAllowedOrigin(origin, env)) add("bad_origin", 4);
  if (!looksLikeBrowser(ua)) add("bot_user_agent", 3);
  if (!acceptLanguage) add("missing_accept_language", 1);
  if (contentLength > LIMITS.bodyBytes) add("body_too_large", 5);

  const ipMinute = await hitLimit(env, `rl:ip:min:${ip}`, LIMITS.ipPerMinute, 60);
  const ipHour = await hitLimit(env, `rl:ip:hour:${ip}`, LIMITS.ipPerHour, 3600);
  const fpMinute = await hitLimit(env, `rl:fp:min:${fingerprint}`, LIMITS.fingerprintPerMinute, 60);

  if (ipMinute.limited) add("ip_minute_rate", 5);
  if (ipHour.limited) add("ip_hour_rate", 5);
  if (fpMinute.limited) add("fingerprint_rate", 4);

  let body;
  try {
    body = await request.json();
  } catch {
    add("invalid_json", 5);
  }

  if (body) {
    const payloadHash = await sha256(JSON.stringify(body).slice(0, LIMITS.bodyBytes));
    const samePayload = await hitLimit(
      env,
      `rl:same:${fingerprint}:${payloadHash}`,
      LIMITS.samePayloadPerTenMinutes,
      600,
    );

    if (samePayload.limited) add("same_payload_repeat", 4);
    validateEstimateBody(body, add);

    const token = body.turnstileToken || request.headers.get("cf-turnstile-token");
    const turnstile = await verifyTurnstile(token, ip, env);
    if (!turnstile.ok) add(turnstile.reason, env.TURNSTILE_SECRET ? 6 : 0);
  }

  const allow = score < 6;
  return {
    allow,
    status: score >= 9 ? 429 : 403,
    requestId,
    body,
    score,
    reasons,
  };

  function add(reason, points) {
    reasons.push(reason);
    score += points;
  }
}

function validateEstimateBody(body, add) {
  const area = Number(body.area);
  const floor = Number(body.floor);
  const allowedBuilding = new Set(["상가", "주거", "사무실", "공장", "병원", "기타"]);
  const allowedDemolition = new Set(["interior", "restore", "closing", "full", "sign"]);

  if (body.website || body.homepage || body.companyUrl) add("honeypot_filled", 8);
  if (!Number.isFinite(area) || area < 1 || area > 2000) add("area_out_of_range", 4);
  if (!Number.isFinite(floor) || floor < 1 || floor > 80) add("floor_out_of_range", 3);
  if (body.building && !allowedBuilding.has(String(body.building))) add("unknown_building", 2);
  if (body.demolitionKey && !allowedDemolition.has(String(body.demolitionKey))) add("unknown_demolition", 2);

  if (body.clientStartedAt) {
    const elapsed = Date.now() - Number(body.clientStartedAt);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1200) add("too_fast_submit", 2);
  }
}

async function verifyTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return { ok: true, reason: "turnstile_not_configured" };
  if (!token || typeof token !== "string" || token.length > 2048) {
    return { ok: false, reason: "turnstile_missing" };
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
      idempotency_key: crypto.randomUUID(),
    }),
  });

  if (!response.ok) return { ok: false, reason: "turnstile_verify_error" };
  const result = await response.json();
  return result.success ? { ok: true } : { ok: false, reason: "turnstile_failed" };
}

async function proxyEstimate(request, env, body) {
  const headers = {
    "content-type": "application/json",
    "x-estimate-guard": "passed",
  };

  if (env.INTERNAL_API_TOKEN) {
    headers.authorization = `Bearer ${env.INTERNAL_API_TOKEN}`;
  }

  const upstream = await fetch(env.ORIGIN_ESTIMATE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const response = new Response(upstream.body, upstream);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

async function hitLimit(env, key, limit, windowSeconds) {
  if (!env.RATE_LIMIT_KV) return { limited: false, count: 0 };

  const now = Math.floor(Date.now() / 1000);
  const current = await env.RATE_LIMIT_KV.get(key, "json");
  const reset = current?.reset && current.reset > now ? current.reset : now + windowSeconds;
  const count = current?.reset && current.reset > now ? current.count + 1 : 1;

  await env.RATE_LIMIT_KV.put(
    key,
    JSON.stringify({ count, reset }),
    { expirationTtl: Math.max(60, reset - now + 5) },
  );

  return { limited: count > limit, count, reset };
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function looksLikeBrowser(ua) {
  if (!ua || ua.length < 20) return false;
  if (/curl|wget|python|scrapy|httpclient|postman|insomnia|bot|spider|crawler/i.test(ua)) {
    return false;
  }
  return /mozilla|chrome|safari|firefox|edg/i.test(ua);
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logBlocked(request, decision) {
  console.warn("estimate request blocked", {
    requestId: decision.requestId,
    ip: request.headers.get("cf-connecting-ip"),
    score: decision.score,
    reasons: decision.reasons,
  });
}

function corsResponse(request, env, body, status = 200) {
  const origin = request.headers.get("origin") || "";
  const headers = new Headers(JSON_HEADERS);
  if (isAllowedOrigin(origin, env)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  headers.set("access-control-allow-methods", "POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, cf-turnstile-token");
  headers.set("access-control-max-age", "600");
  return new Response(body, { status, headers });
}

function json(request, env, payload, status = 200) {
  return corsResponse(request, env, JSON.stringify(payload), status);
}
