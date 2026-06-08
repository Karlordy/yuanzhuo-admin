const API_BASE = (import.meta.env.VITE_REPORT_API_BASE || "").replace(/\/$/, "");

async function apiJson(path, { method = "GET", token, body } = {}) {
  if (!API_BASE) throw new Error("VITE_REPORT_API_BASE is missing.");
  if (!token) throw new Error("Missing Supabase access token.");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export function listAdminUsers(token) {
  return apiJson("/admin/users", { token });
}

export function createAdminUser(token, payload) {
  return apiJson("/admin/users", { method: "POST", token, body: payload });
}

export function disableAdminUser(token, userId) {
  return apiJson(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", token });
}

export function batchDownloadReports(token, reportIds) {
  return apiJson("/reports/batch-download", {
    method: "POST",
    token,
    body: { report_ids: reportIds },
  });
}
