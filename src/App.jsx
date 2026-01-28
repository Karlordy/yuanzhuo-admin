import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import RadarSemiRadar from "./RadarSemiRadar";
import ReportTemplate from "./ReportTemplate.jsx";

window.supabase = supabase;

// ====================== 工具函数 ======================
function safeStr(x) {
  try {
    if (typeof x === "string") return x;
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function toNumMaybe(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function toFixed2(v) {
  const n = toNumMaybe(v);
  return n == null ? null : Number(n.toFixed(2));
}
function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k];
  }
  return undefined;
}
function normalizeSubName(name) {
  const s = String(name ?? "").trim();
  if (!s) return "";
  if (s === "工作狂/野心") return "工作狂";
  return s;
}

function buildScoreMapsFromSnapshot(snapshot) {
  const rawSubs = snapshot?.subscores;
  const rawDims = snapshot?.dimscores;

  const subMap = {};
  if (Array.isArray(rawSubs)) {
    for (const it of rawSubs) {
      if (Array.isArray(it) && it.length >= 2) {
        const subName = normalizeSubName(it[0]);
        const score = toFixed2(it[1]);
        if (subName) subMap[subName] = score;
        continue;
      }
      const rawName = pickFirst(it, ["sub", "subName", "sub_name", "name", "label", "title"]);
      const subName = normalizeSubName(rawName);
      const score = toFixed2(pickFirst(it, ["score", "value", "avg", "mean", "result"]));
      if (subName) subMap[subName] = score;
    }
  } else if (rawSubs && typeof rawSubs === "object") {
    for (const [k, v] of Object.entries(rawSubs)) {
      const kk = normalizeSubName(k);
      if (kk) subMap[kk] = toFixed2(v);
    }
  }

  const dimMap = {};
  if (rawDims && typeof rawDims === "object" && !Array.isArray(rawDims)) {
    for (const [k, v] of Object.entries(rawDims)) dimMap[String(k).trim()] = toFixed2(v);
  } else if (Array.isArray(rawDims)) {
    for (const it of rawDims) {
      const dimName = String(pickFirst(it, ["dim", "dimName", "name", "label"]) ?? "").trim();
      const score = toFixed2(pickFirst(it, ["score", "value", "avg", "mean"]));
      if (dimName) dimMap[dimName] = score;
    }
  }

  return { subMap, dimMap };
}

function sanitizeFileName(name) {
  return String(name || "download")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 只负责打开后端返回的 signed url
 * 关键：不要 fetch，不要加 headers，直接 window.open
 */
function openSignedUrl(url) {
  const u = String(url || "").trim();
  if (!u) {
    alert("没有拿到下载链接 url");
    return;
  }
  window.open(u, "_blank");
}

// ====================== report-api 地址（统一管理） ======================
const REPORT_API_BASE = (import.meta.env.VITE_REPORT_API_BASE || "http://localhost:8080").replace(/\/$/, "");
const REPORT_API_GENERATE_URL = `${REPORT_API_BASE}/report/generate`;
const REPORT_API_STATUS_URL = `${REPORT_API_BASE}/report/status`;

// ====================== App ======================
export default function App() {
  const [session, setSession] = useState(null);

  // login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");

  // authz
  const [loadingAuthz, setLoadingAuthz] = useState(false);
  const [adminRow, setAdminRow] = useState(undefined);

  // tabs
  const [tab, setTab] = useState("submissions");

  // submissions
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [subs, setSubs] = useState([]);
  const [subsErr, setSubsErr] = useState("");
  const [q, setQ] = useState("");

  // reports
  const [loadingReports, setLoadingReports] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportsErr, setReportsErr] = useState("");

  // preview
  const [preview, setPreview] = useState(null);
  const radarApiRef = useRef(null);
  const [previewRadarPng, setPreviewRadarPng] = useState(null);

  // ✅ 生成PDF用（隐藏渲染）
  const radarJobApiRef = useRef(null);
  const [radarJob, setRadarJob] = useState(null);
  const [radarJobReady, setRadarJobReady] = useState(false);

  // per-row action
  const [busyId, setBusyId] = useState(null);

  // env
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  const FN_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/generate-report` : "";

  // ============ auth ============
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAdminRow(undefined);
      setLoginErr("");
      setSubs([]);
      setSubsErr("");
      setReports([]);
      setReportsErr("");
      setPreview(null);
      setPreviewRadarPng(null);

      radarApiRef.current = null;
      radarJobApiRef.current = null;
      setRadarJob(null);
      setRadarJobReady(false);

      setTab("submissions");
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      if (!session?.user?.id) return;

      setLoadingAuthz(true);
      try {
        const uid = session.user.id;

        const { data, error } = await supabase
          .from("admin_users")
          .select("user_id,email,role,is_active")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) throw error;

        if (!data) setAdminRow({ blocked: true, reason: "not_found" });
        else if (data.is_active === false) setAdminRow({ blocked: true, reason: "inactive" });
        else setAdminRow(data);
      } catch (e) {
        setAdminRow({ blocked: true, reason: "rls_or_error", message: e?.message });
      } finally {
        setLoadingAuthz(false);
      }
    })();
  }, [session?.user?.id]);

  // ============ data fetch ============
  async function fetchSubmissions() {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked) return;

    setLoadingSubs(true);
    setSubsErr("");
    try {
      const { data, error } = await supabase
        .from("submissions")
        .select("id, created_at, name, company, insight_text, subscores, dimscores, focus_low3, focus_high2")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setSubs(data || []);
    } catch (e) {
      setSubsErr(e?.message || String(e));
    } finally {
      setLoadingSubs(false);
    }
  }

  async function fetchReports() {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked) return;

    setLoadingReports(true);
    setReportsErr("");
    try {
      const { data, error } = await supabase
        .from("reports")
        .select("id, created_at, submission_id, status, error, pdf_path, radar_path, file_name, snapshot, updated_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setReports(data || []);
    } catch (e) {
      setReportsErr(e?.message || String(e));
    } finally {
      setLoadingReports(false);
    }
  }

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked) return;
    fetchSubmissions();
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, adminRow]);

  const filteredSubs = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return subs;
    return subs.filter((r) => `${r.name || ""} ${r.company || ""}`.toLowerCase().includes(kw));
  }, [subs, q]);

  const reportBySubmissionId = useMemo(() => {
    const m = new Map();
    for (const r of reports) {
      if (r?.submission_id && !m.has(r.submission_id)) m.set(r.submission_id, r);
    }
    return m;
  }, [reports]);

  async function signIn(e) {
    e.preventDefault();
    setLoginErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginErr(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setAdminRow(undefined);
    setSubs([]);
    setReports([]);
    setPreview(null);
    radarApiRef.current = null;

    radarJobApiRef.current = null;
    setRadarJob(null);
    setRadarJobReady(false);
  }

  // ============ create report row ============
  async function createReportForSubmission(s) {
    if (!s?.id) return;
    setBusyId(s.id);
    try {
      const existing = reportBySubmissionId.get(s.id);
      if (existing) return;

      const snapshot = {
        name: s.name,
        company: s.company,
        submission_created_at: s.created_at,
        subscores: s.subscores ?? null,
        dimscores: s.dimscores ?? null,
        focus_low3: s.focus_low3 ?? null,
        focus_high2: s.focus_high2 ?? null,
        insight_text: s.insight_text ?? null,
      };

      const displayFileName = `${s.name || "姓名"}-${s.company || "公司"}-领导力测评报告.pdf`;

      const { error } = await supabase.from("reports").insert({
        submission_id: s.id,
        status: "queued",
        error: null,
        snapshot,
        file_name: displayFileName,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
      await fetchReports();
    } catch (e) {
      alert("生成报告记录失败：\n" + (e?.message || String(e)));
    } finally {
      setBusyId(null);
    }
  }

  // ============ radar preview download ============
  function downloadRadarPng() {
    try {
      const api = radarApiRef.current;
      if (!api?.exportPng) {
        alert("雷达图导出能力未就绪：等待 RadarSemiRadar onReady()...");
        return;
      }
      const dataUrl = api.exportPng({ pixelRatio: 3, backgroundColor: "#ffffff" });

      const a = document.createElement("a");
      const title = sanitizeFileName(preview?.title || "雷达图");
      a.href = dataUrl;
      a.download = `${title}-雷达图.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert("导出PNG失败：\n" + (e?.message || String(e)));
    }
  }

  // ============ report-api calls ============
  async function getAccessTokenOrThrow() {
    const { data: sessData } = await supabase.auth.getSession();
    const accessToken = sessData?.session?.access_token;
    if (!accessToken) throw new Error("未登录或登录已过期，请重新登录");
    return accessToken;
  }

  async function postJson(url, body, accessToken) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body || {}),
    });

    const text = await resp.text().catch(() => "");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`后端返回不是 JSON：HTTP ${resp.status}\n${text.slice(0, 400)}`);
    }

    if (!resp.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${resp.status}`);
    }
    return data;
  }

  // ✅ 轮询 /report/status，直到拿到 pdf.url 或超时
  async function waitPdfUrlOrThrow({ submissionId, accessToken, timeoutMs = 90000, intervalMs = 1000 }) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const resp = await fetch(
        `${REPORT_API_STATUS_URL}?submission_id=${encodeURIComponent(submissionId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      const text = await resp.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`轮询状态接口返回不是 JSON：HTTP ${resp.status}\n${text.slice(0, 400)}`);
      }

      const status = data?.report?.status || data?.status;
      const url = data?.pdf?.url;

      if (url && status === "done") return url;

      if (status === "error" || status === "failed") {
        throw new Error(data?.report?.error || data?.error || "PDF 生成失败（status=error）");
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error("等待下载链接超时：PDF 生成时间过长或 status 未返回 url");
  }

  // ✅ 点击“生成PDF(含雷达图)”：启动隐藏雷达 job
  function startGeneratePdfWithRadar(reportRow) {
    const snap = reportRow?.snapshot || {};
    if (!snap?.subscores || !snap?.dimscores) {
      alert("该报告 snapshot 里没有测评数据，无法生成雷达图");
      return;
    }

    const { subMap, dimMap } = buildScoreMapsFromSnapshot(snap);
    const title = `${snap.name || ""}-${snap.company || ""}`.trim() || "雷达图";

    setBusyId(reportRow.id);

    radarJobApiRef.current = null;
    setRadarJobReady(false);
    setRadarJob({ reportRow, subMap, dimMap, title });
  }

  // ✅ 隐藏图 onReady：稳定引用 + ref 保存 api
  const onRadarJobReady = useCallback((api) => {
    radarJobApiRef.current = api;
    setRadarJobReady((prev) => (prev ? prev : true));
  }, []);

  // ✅ radarJob 流程：等 ready 后 exportPngAsync → 发后端 /report/generate?mode=signed_url → 轮询 /report/status → openSignedUrl
  useEffect(() => {
    (async () => {
      if (!radarJob) return;
      if (!radarJobReady) return;

      const reportRow = radarJob.reportRow;

      try {
        const api = radarJobApiRef.current;
        if (!api?.exportPngAsync) throw new Error("Radar 图导出能力未就绪（exportPngAsync 缺失）");

        const radarPngDataUrl = await api.exportPngAsync({
          pixelRatio: 3,
          backgroundColor: "#ffffff",
          timeoutMs: 8000,
        });

        const accessToken = await getAccessTokenOrThrow();

        // 1) 触发后台生成（会返回 processing，不直接返回 url）
        await postJson(
          `${REPORT_API_GENERATE_URL}?mode=signed_url`,
          {
            submission_id: reportRow.submission_id,
            radar_png_data_url: radarPngDataUrl,
            display_file_name: reportRow.file_name || null,
          },
          accessToken
        );

        // 2) 刷新一次列表
        await fetchReports();

        // 3) 轮询拿 url（关键）
        const pdfUrl = await waitPdfUrlOrThrow({
          submissionId: reportRow.submission_id,
          accessToken,
          timeoutMs: 90000,
          intervalMs: 1000,
        });

        openSignedUrl(pdfUrl);
        alert("PDF 已生成 ✅（已打开下载链接）");

        // 4) 再刷新一次（把 done / pdf_path 显示出来）
        await fetchReports();
      } catch (e) {
        alert("生成PDF失败：\n" + (e?.message || String(e)));
      } finally {
        radarJobApiRef.current = null;
        setRadarJob(null);
        setRadarJobReady(false);
        setBusyId(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarJob, radarJobReady]);

  // ---------- styles ----------
  const page = { minHeight: "100vh", background: "#fff", color: "#0f172a", padding: 24 };
  const card = {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 18,
    boxShadow: "0 10px 28px rgba(2, 6, 23, .06)",
    background: "#fff",
    color: "#0f172a",
  };
  const btn = {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
  const btnPrimary = {
    ...btn,
    border: "1px solid rgba(124,58,237,.35)",
    background: "rgba(124,58,237,.1)",
  };
  const pill = (active) => ({
    ...btn,
    background: active ? "rgba(15,23,42,.06)" : "#fff",
    fontWeight: active ? 800 : 600,
  });

  // ---------- render ----------
  if (!session) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fff" }}>
        <div style={{ ...card, width: 460, maxWidth: "92vw" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>圆桌经营会｜后台登录</h1>
          <p style={{ marginTop: 8, marginBottom: 14, color: "#64748b", fontSize: 12 }}>
            请输入管理员账号（Supabase Auth 用户）
          </p>

          <form onSubmit={signIn} style={{ display: "grid", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>邮箱</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                style={{
                  width: "100%",
                  padding: "12px 12px",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 14,
                }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>密码</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%",
                  padding: "12px 12px",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  fontSize: 14,
                }}
              />
            </label>

            {loginErr ? (
              <div style={{ color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>{loginErr}</div>
            ) : (
              <div style={{ minHeight: 16 }} />
            )}

            <button type="submit" style={{ ...btnPrimary, width: "100%", marginTop: 4 }}>
              登录
            </button>

            <div style={{ marginTop: 10, color: "#64748b", fontSize: 11, whiteSpace: "pre-wrap" }}>
              ENV:{"\n"}VITE_SUPABASE_URL={SUPABASE_URL ? "OK" : "MISSING"}{"\n"}VITE_SUPABASE_ANON_KEY=
              {SUPABASE_ANON_KEY ? "OK" : "MISSING"}
              {"\n"}REPORT_API_BASE={REPORT_API_BASE}
              {"\n"}FN_URL={FN_URL || "(missing)"}
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (loadingAuthz || adminRow === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fff" }}>
        <div style={{ ...card, width: 520, maxWidth: "92vw" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>正在校验权限…</h1>
          <p style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>登录：{session.user.email}</p>
        </div>
      </div>
    );
  }

  if (adminRow?.blocked) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fff" }}>
        <div style={{ ...card, width: 560, maxWidth: "92vw" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>已登录，但未授权</h1>
          <p style={{ marginTop: 8, color: "#64748b", fontSize: 12, lineHeight: 1.7 }}>
            当前账号：{session.user.email}
            <br />
            该账号不在 admin_users 授权名单中，或已停用。
          </p>

          {adminRow.message ? (
            <div style={{ marginTop: 10, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>
              {adminRow.message}
            </div>
          ) : null}

          <button onClick={signOut} style={{ ...btn, marginTop: 12 }}>
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>圆桌经营会｜后台管理</h1>
            <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
              登录：{session.user.email} ｜ 角色：{adminRow?.role || "-"}
            </div>
            <div style={{ marginTop: 6, color: "#64748b", fontSize: 11, whiteSpace: "pre-wrap" }}>
              REPORT_API_BASE: {REPORT_API_BASE}
              {"\n"}FN_URL: {FN_URL || "(missing VITE_SUPABASE_URL)"}
            </div>
          </div>
          <button onClick={signOut} style={btn}>
            退出
          </button>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
          <button style={pill(tab === "submissions")} onClick={() => setTab("submissions")}>
            Submissions
          </button>
          <button style={pill(tab === "reports")} onClick={() => setTab("reports")}>
            Reports
          </button>
          <button
            style={{ ...btn, marginLeft: "auto" }}
            onClick={() => {
              fetchSubmissions();
              fetchReports();
            }}
          >
            刷新
          </button>
        </div>

        {tab === "submissions" ? (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Submissions（最近 200 条）</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索 姓名 / 公司"
                  style={{
                    width: 240,
                    maxWidth: "70vw",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    fontSize: 14,
                  }}
                />
              </div>
            </div>

            {loadingSubs ? (
              <div style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>加载中…</div>
            ) : subsErr ? (
              <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>
                读取 submissions 失败：{subsErr}
              </div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {filteredSubs.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>暂无数据</div>
                ) : (
                  filteredSubs.map((s) => {
                    const rep = reportBySubmissionId.get(s.id);
                    const hasReport = !!rep;
                    return (
                      <div
                        key={s.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 14,
                          padding: 12,
                          background: "#fff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 800 }}>
                            {s.name || "-"} ｜ {s.company || "-"}
                            <span style={{ marginLeft: 10, color: "#64748b", fontSize: 12, fontWeight: 500 }}>
                              {s.created_at ? new Date(s.created_at).toLocaleString() : ""}
                            </span>
                          </div>

                          {hasReport ? (
                            <span style={{ color: "#64748b", fontSize: 12 }}>已有报告：{rep.status}</span>
                          ) : (
                            <button
                              style={btnPrimary}
                              disabled={busyId === s.id}
                              onClick={() => createReportForSubmission(s)}
                            >
                              {busyId === s.id ? "创建中…" : "生成报告记录"}
                            </button>
                          )}
                        </div>

                        {s.insight_text ? (
                          <pre
                            style={{
                              marginTop: 8,
                              marginBottom: 0,
                              background: "#f8fafc",
                              borderRadius: 12,
                              padding: 10,
                              overflowX: "auto",
                              whiteSpace: "pre-wrap",
                              fontSize: 12,
                              color: "#0f172a",
                              border: "1px solid #e2e8f0",
                            }}
                          >
                            {s.insight_text}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Reports（最近 200 条）</div>
              {loadingReports ? <div style={{ color: "#64748b", fontSize: 12 }}>加载中…</div> : null}
            </div>

            {reportsErr ? (
              <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>
                读取 reports 失败：{reportsErr}
              </div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {reports.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>暂无报告（先去 Submissions 创建报告记录）</div>
                ) : (
                  reports.map((r) => {
                    const snap = r.snapshot || {};
                    const canPreviewRadar =
                      (Array.isArray(snap?.subscores) && snap.subscores.length > 0) &&
                      (snap?.dimscores && (Array.isArray(snap.dimscores) || typeof snap.dimscores === "object"));

                    return (
                      <div
                        key={r.id}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 14,
                          padding: 12,
                          background: "#fff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 800 }}>
                            {(snap.name || r.name || "-") + " ｜ " + (snap.company || r.company || "-")}
                            <span style={{ marginLeft: 10, color: "#64748b", fontSize: 12, fontWeight: 500 }}>
                              {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            {canPreviewRadar ? (
                              <button
                                style={btn}
                                disabled={busyId === r.id}
                                onClick={() => {
                                  const { subMap, dimMap } = buildScoreMapsFromSnapshot(r.snapshot);
                                  radarApiRef.current = null;
                                  setPreview({
                                    reportId: r.id,
                                    submissionId: r.submission_id,
                                    snapshot: r.snapshot,
                                    subMap,
                                    dimMap,
                                    title: `${snap.name || ""}-${snap.company || ""}`.trim(),
                                  });
                                }}
                              >
                                查看雷达图
                              </button>
                            ) : (
                              <span style={{ color: "#94a3b8", fontSize: 12 }}>（无测评数据）</span>
                            )}

                            <button
                              style={btnPrimary}
                              disabled={busyId === r.id}
                              onClick={() => startGeneratePdfWithRadar(r)}
                              title="导出雷达PNG→后端嵌入PDF→后台生成→轮询拿下载链接→自动打开"
                            >
                              {busyId === r.id ? "生成中…" : "生成PDF(含雷达图)"}
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: 6, color: "#64748b", fontSize: 12, lineHeight: 1.7 }}>
                          状态：<b style={{ color: "#0f172a" }}>{r.status || "-"}</b>
                          {r.error ? <span style={{ color: "#dc2626" }}> ｜ {r.error}</span> : null}
                          <br />
                          report_id：{r.id}
                          <br />
                          submission_id：{r.submission_id}
                          <br />
                          updated_at：{r.updated_at ? new Date(r.updated_at).toLocaleString() : "-"}
                        </div>

                        <div style={{ marginTop: 6, color: "#64748b", fontSize: 12 }}>
                          文件：{r.file_name || "-"} {r.pdf_path ? `（${r.pdf_path}）` : ""}
                          {r.radar_path ? ` ｜ radar：${r.radar_path}` : ""}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {preview?.subMap && preview?.dimMap ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>雷达图预览 {preview.title ? `｜${preview.title}` : ""}</div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                      style={btnPrimary}
                      disabled={!radarApiRef.current?.exportPng}
                      onClick={downloadRadarPng}
                      title={!radarApiRef.current?.exportPng ? "等待 RadarSemiRadar onReady()..." : ""}
                    >
                      纯前端下载PNG
                    </button>

                    <button
                      style={btn}
                      disabled={!radarApiRef.current?.exportPng}
                      onClick={() => {
                        const api = radarApiRef.current;
                        const dataUrl = api.exportPng({ pixelRatio: 3, backgroundColor: "#ffffff" });
                        setPreviewRadarPng(dataUrl);
                      }}
                    >
                      生成报告预览PNG
                    </button>

                    <button
                      style={btn}
                      onClick={() => {
                        radarApiRef.current = null;
                        setPreview(null);
                        setPreviewRadarPng(null);
                      }}
                    >
                      关闭预览
                    </button>
                  </div>
                </div>

                <div style={{ width: "100%", height: 980, overflow: "visible", marginTop: 10 }}>
                  <RadarSemiRadar
                    subScores={preview.subMap}
                    dimScores={preview.dimMap}
                    onReady={(api) => {
                      radarApiRef.current = api;
                    }}
                  />
                  {preview?.snapshot ? (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 800, marginBottom: 8 }}>报告预览（定稿版样式）</div>
                      <ReportTemplate snapshot={preview.snapshot} radarPngDataUrl={previewRadarPng} />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ✅ 隐藏渲染：用于导出PNG并发给后端 */}
      {radarJob ? (
        <div
          style={{
            position: "fixed",
            left: -10000,
            top: -10000,
            width: 1200,
            height: 900,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <RadarSemiRadar subScores={radarJob.subMap} dimScores={radarJob.dimMap} onReady={onRadarJobReady} />
        </div>
      ) : null}
    </div>
  );
}
