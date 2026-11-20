export function parseHttpsOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !url.hostname.includes('.') ||
    !/^[a-z0-9.-]+$/i.test(url.hostname)
  ) {
    return null;
  }
  return url.origin;
}

export function parseSupabaseOrigin(value) {
  const origin = parseHttpsOrigin(value);
  if (!origin) return null;
  const { hostname } = new URL(origin);
  return /^[a-z0-9-]{4,64}\.supabase\.co$/i.test(hostname) ? origin : null;
}

export function normalizeEmail(value, fallback = 'admin@example.com') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function resolveAllowedOrigin(env) {
  return parseHttpsOrigin(env?.ALLOWED_ORIGIN);
}

export function resolveSupabaseOrigin(env) {
  return parseSupabaseOrigin(env?.SUPABASE_URL);
}

export function resolveSiteOrigin(env) {
  return resolveAllowedOrigin(env) || 'https://ltch.example.com';
}

export function resolveApiOrigin(env, requestUrl) {
  const configured = parseHttpsOrigin(env?.API_ORIGIN);
  if (configured) return configured;
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {}
  }
  return '';
}

export function resolveFirebaseProjectId(env) {
  if (typeof env?.FIREBASE_PROJECT_ID === 'string') {
    const trimmed = env.FIREBASE_PROJECT_ID.trim();
    if (/^[a-z0-9-]{4,64}$/.test(trimmed)) return trimmed;
  }
  return 'your-firebase-project';
}

export function resolveAdminEmail(env) {
  return normalizeEmail(env?.ADMIN_EMAIL, 'admin@example.com');
}

export function resolveDriveOwnerEmail(env) {
  return normalizeEmail(env?.DRIVE_OWNER_EMAIL || env?.ADMIN_EMAIL, 'admin@example.com');
}
