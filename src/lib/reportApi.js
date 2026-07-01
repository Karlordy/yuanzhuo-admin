const API_BASE = import.meta.env.VITE_REPORT_API_BASE;

function mustOk(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res;
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
  return normal?.[1] || fallback || "领导力测评报告.pdf";
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

export async function reportGenerateAsync(submission_id, extra = {}) {
  const res = await fetch(`${API_BASE}/report/generate?mode=async`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_REPORT_API_KEY}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ submission_id, ...extra }),
  }).then(mustOk);

  return res.json();
}


export async function reportStatus(submission_id) {
  const res = await fetch(
    `${API_BASE}/report/status?submission_id=${encodeURIComponent(submission_id)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_REPORT_API_KEY}`,
        Accept: "application/json",
      },
    }
  ).then(mustOk);

  return res.json();
}

export async function reportSignedUrl(submission_id) {
  const res = await fetch(`${API_BASE}/report/signed-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_REPORT_API_KEY}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ submission_id }),
  }).then(mustOk);

  return res.json();
}

export async function downloadReportViaRelay(submission_id, fallbackName = "领导力测评报告.pdf") {
  const res = await fetch(`${API_BASE}/report/download?submission_id=${encodeURIComponent(submission_id)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_REPORT_API_KEY}`,
      Accept: "application/pdf",
    },
  }).then(mustOk);

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("content-disposition"), fallbackName);
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size };
}

export async function waitReportDone(submission_id, intervalMs = 2000, timeoutMs = 180000) {
  const start = Date.now();

  while (true) {
    const data = await reportStatus(submission_id);

    if (data?.ok && data?.report?.status === "done") return data;
    if (data?.ok && data?.report?.status === "error") {
      throw new Error(data?.report?.error || "report status=error");
    }

    if (Date.now() - start > timeoutMs) throw new Error("waitReportDone timeout");

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
