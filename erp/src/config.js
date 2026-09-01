const LOCAL_DEMO_SESSION_KEY = "cryo-erp-local-demo";
const SECRET_KEY_PREFIX = `${["sb", "secret"].join("_")}_`;

export function isLocalHost(locationLike = globalThis.location) {
  const hostname = locationLike?.hostname?.toLowerCase?.() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function isEmbeddedWindow(windowLike = globalThis.window) {
  try {
    return Boolean(windowLike && windowLike.top !== windowLike.self);
  } catch {
    return true;
  }
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    if (typeof globalThis.atob !== "function") return null;
    const decoded = globalThis.atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function validateSupabaseBrowserConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return {
      status: "missing",
      message: "Browser-ийн runtime тохиргоо олдсонгүй.",
    };
  }

  const supabaseUrl = String(rawConfig.supabaseUrl ?? "").trim();
  const publishableKey = String(
    rawConfig.supabasePublishableKey ?? rawConfig.supabaseAnonKey ?? "",
  ).trim();

  if (!supabaseUrl && !publishableKey) {
    return {
      status: "missing",
      message: "Supabase project URL болон browser publishable key тохируулаагүй байна.",
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    return { status: "invalid", message: "Supabase URL хүчинтэй биш байна." };
  }

  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
    return {
      status: "invalid",
      message: "Supabase URL нь HTTPS бүхий албан ёсны project URL байх ёстой.",
    };
  }

  if (!publishableKey) {
    return { status: "invalid", message: "Browser-ийн publishable key олдсонгүй." };
  }

  if (publishableKey.startsWith(SECRET_KEY_PREFIX)) {
    return {
      status: "invalid",
      message: "Secret key-г browser-д ашиглахыг хориглосон.",
    };
  }

  const isPublishable = publishableKey.startsWith("sb_publishable_");
  const jwtPayload = publishableKey.split(".").length === 3 ? decodeJwtPayload(publishableKey) : null;
  const isLegacyAnon = jwtPayload?.role === "anon";

  if (jwtPayload?.role === "service_role") {
    return {
      status: "invalid",
      message: "Өндөр эрхтэй server key-г browser-д ашиглахыг хориглосон.",
    };
  }

  if (!isPublishable && !isLegacyAnon) {
    return {
      status: "invalid",
      message: "Зөвхөн Supabase publishable эсвэл legacy anon key ашиглана.",
    };
  }

  return {
    status: "ready",
    mode: "remote",
    supabaseUrl: parsedUrl.origin,
    publishableKey,
  };
}

export function readRuntimeConfig({
  windowLike = globalThis.window,
  locationLike = globalThis.location,
  sessionStorageLike = globalThis.sessionStorage,
} = {}) {
  const local = isLocalHost(locationLike);
  const demoEnabled = local && sessionStorageLike?.getItem?.(LOCAL_DEMO_SESSION_KEY) === "1";

  if (demoEnabled) {
    return { status: "ready", mode: "local-demo", localOnly: true };
  }

  const result = validateSupabaseBrowserConfig(windowLike?.CRYO_ERP_CONFIG);
  return { ...result, canUseLocalDemo: local };
}

export function enableLocalDemo(sessionStorageLike = globalThis.sessionStorage) {
  sessionStorageLike?.setItem?.(LOCAL_DEMO_SESSION_KEY, "1");
}

export function disableLocalDemo(sessionStorageLike = globalThis.sessionStorage) {
  sessionStorageLike?.removeItem?.(LOCAL_DEMO_SESSION_KEY);
}
