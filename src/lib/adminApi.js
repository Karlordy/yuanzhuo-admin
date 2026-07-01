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

function filenameFromContentDisposition(header, fallback) {
  const h = String(header || "");
  const star = h.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const normal = h.match(/filename="?([^";]+)"?/i);
  return normal?.[1] || fallback || "reports.zip";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function apiDownload(path, { method = "GET", token, body, fallbackName } = {}) {
  if (!API_BASE) throw new Error("VITE_REPORT_API_BASE is missing.");
  if (!token) throw new Error("Missing Supabase access token.");

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/octet-stream",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    try {
      const data = text ? JSON.parse(text) : null;
      throw new Error(data?.error || `HTTP ${res.status}`);
    } catch (e) {
      if (e?.message && !e.message.startsWith("Unexpected")) throw e;
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("content-disposition"), fallbackName);
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size };
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

export function batchDownloadReportsFile(token, reportIds) {
  return apiDownload("/reports/batch-download-file", {
    method: "POST",
    token,
    body: { report_ids: reportIds },
    fallbackName: "领导力测评报告批量下载.zip",
  });
}

export function listRetestAllowances(token) {
  return apiJson("/admin/retest-allowances", { token });
}

export function allowRetest(token, payload) {
  return apiJson("/admin/retest-allowances", {
    method: "POST",
    token,
    body: payload,
  });
}
