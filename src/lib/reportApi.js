const API_BASE = import.meta.env.VITE_REPORT_API_BASE;

function mustOk(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res;
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
