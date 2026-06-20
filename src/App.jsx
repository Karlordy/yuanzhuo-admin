import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import RadarSemiRadar from "./RadarSemiRadar";
import ReportTemplate from "./ReportTemplate.jsx";
import { reportGenerateAsync, reportSignedUrl, waitReportDone } from "./lib/reportApi.js";
import { allowRetest, batchDownloadReports, createAdminUser, disableAdminUser, listAdminUsers, listRetestAllowances } from "./lib/adminApi.js";


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

const RADAR32_GROUPS = [
  { dim: "成就导向", subs: ["决断力", "领导效能", "取得成果", "使命愿景", "战略关注"] },
  { dim: "系统意识", subs: ["持续性产出", "关心社会", "平衡", "系统思考", "资源统筹"] },
  { dim: "自我觉察", subs: ["沉着", "反思自省", "无私领导", "学习者", "正直真实"] },
  { dim: "协同赋能", subs: ["关爱", "团队合作", "培育", "人际交往", "协作者"] },
  { dim: "控制", subs: ["工作狂", "完美", "野心", "专制"] },
  { dim: "防御", subs: ["傲慢", "距离感", "挑剔", "自我辩护"] },
  { dim: "顺从", subs: ["保守", "被动", "归属", "取悦"] },
];

const RADAR32_NEW_ONLY = [
  "决断力",
  "领导效能",
  "持续性产出",
  "关心社会",
  "资源统筹",
  "无私领导",
  "正直真实",
  "人际交往",
  "协作者",
  "野心",
  "自我辩护",
  "归属",
];

function avg(nums) {
  const vals = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!vals.length) return null;
  return toFixed2(vals.reduce((sum, n) => sum + n, 0) / vals.length);
}

function getAnswerScore(answers, qNumber) {
  if (!answers || typeof answers !== "object") return null;
  const padded = `Q${String(qNumber).padStart(3, "0")}`;
  const raw =
    answers[String(qNumber)] ??
    answers[qNumber] ??
    answers[padded] ??
    answers[padded.toLowerCase()];
  return toFixed2(raw);
}

function buildModel32ScoreMapsFromAnswers(answers) {
  if (!answers || typeof answers !== "object") return null;

  const subMap = {};
  const dimMap = {};
  let q = 1;
  let scoredSubCount = 0;

  for (const group of RADAR32_GROUPS) {
    const dimVals = [];
    for (const sub of group.subs) {
      const score = avg([getAnswerScore(answers, q), getAnswerScore(answers, q + 1), getAnswerScore(answers, q + 2)]);
      q += 3;
      if (score != null) {
        subMap[sub] = score;
        dimVals.push(score);
        scoredSubCount += 1;
      }
    }
    dimMap[group.dim] = avg(dimVals);
  }

  if (scoredSubCount < 32) return null;
  return { subMap, dimMap };
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

  const computed32 = buildModel32ScoreMapsFromAnswers(snapshot?.answers_adjusted || snapshot?.answers_raw);
  const hasModel32 = RADAR32_NEW_ONLY.some((name) => Object.prototype.hasOwnProperty.call(subMap, name));
  if (computed32 && !hasModel32) return computed32;

  return { subMap, dimMap };
}

function buildSnapshotFromSubmission(s) {
  if (!s) return {};
  return {
    name: s.name,
    company: s.company,
    submission_created_at: s.created_at,
    answers_raw: s.answers_raw ?? null,
    answers_adjusted: s.answers_adjusted ?? null,
    subscores: s.subscores ?? null,
    dimscores: s.dimscores ?? null,
    focus_low3: s.focus_low3 ?? null,
    focus_high2: s.focus_high2 ?? null,
    insight_text: s.insight_text ?? null,
  };
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
  window.open(u, "_blank", "noopener,noreferrer");
}

function saveActiveReportJob(job) {
  try {
    window.localStorage.setItem(ACTIVE_REPORT_JOB_KEY, JSON.stringify({ ...job, saved_at: Date.now() }));
  } catch {
    // ignore
  }
}

function loadActiveReportJob() {
  try {
    const raw = window.localStorage.getItem(ACTIVE_REPORT_JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearActiveReportJob() {
  try {
    window.localStorage.removeItem(ACTIVE_REPORT_JOB_KEY);
  } catch {
    // ignore
  }
}

// ====================== report-api 地址（统一管理） ======================
const REPORT_API_BASE = (import.meta.env.VITE_REPORT_API_BASE || "http://localhost:3000").replace(/\/$/, "");
const REPORT_API_GENERATE_URL = `${REPORT_API_BASE}/report/generate`;
const REPORT_API_STATUS_URL = `${REPORT_API_BASE}/report/status`;
const ACTIVE_REPORT_JOB_KEY = "yuanzhuo_admin_active_report_job";

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
  const [selectedReportIds, setSelectedReportIds] = useState([]);
  const [batchBusy, setBatchBusy] = useState(false);

  // admin users
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUsersErr, setAdminUsersErr] = useState("");
  const [adminUsersBusy, setAdminUsersBusy] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newAdminRole, setNewAdminRole] = useState("report_admin");

  // retest allowances
  const [retestAllowances, setRetestAllowances] = useState([]);
  const [retestErr, setRetestErr] = useState("");
  const [retestBusy, setRetestBusy] = useState(false);
  const [retestName, setRetestName] = useState("");
  const [retestCompany, setRetestCompany] = useState("");
  const [retestCount, setRetestCount] = useState(1);
  const [retestNote, setRetestNote] = useState("");

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
  const recoveringJobRef = useRef(false);
  const activeUserIdRef = useRef(null);

  // env
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  const FN_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/generate-report` : "";

  // ============ auth ============
  useEffect(() => {
    function resetAuthScopedState() {
      setSubs([]);
      setSubsErr("");
      setReports([]);
      setReportsErr("");
      setSelectedReportIds([]);
      setAdminUsers([]);
      setAdminUsersErr("");
      setRetestAllowances([]);
      setRetestErr("");
      setPreview(null);
      setPreviewRadarPng(null);

      radarApiRef.current = null;
      radarJobApiRef.current = null;
      setRadarJob(null);
      setRadarJobReady(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      const nextSession = data.session || null;
      activeUserIdRef.current = nextSession?.user?.id || null;
      setSession(nextSession);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setLoginErr("");

      const nextUserId = nextSession?.user?.id || null;
      const prevUserId = activeUserIdRef.current;

      if (!nextSession) {
        activeUserIdRef.current = null;
        setSession(null);
        setAdminRow(undefined);
        resetAuthScopedState();
        setTab("submissions");
        return;
      }

      if (prevUserId && prevUserId === nextUserId) {
        setSession(nextSession);
        return;
      }

      activeUserIdRef.current = nextUserId;
      setSession(nextSession);
      setAdminRow(undefined);
      resetAuthScopedState();
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
        .select("id, created_at, name, company, answers_raw, answers_adjusted, insight_text, subscores, dimscores, focus_low3, focus_high2")
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

  async function fetchAdminUsers() {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked || adminRow.role !== "system_admin") return;

    setAdminUsersBusy(true);
    setAdminUsersErr("");
    try {
      const token = await getAccessTokenOrThrow();
      const data = await listAdminUsers(token);
      setAdminUsers(data?.users || []);
    } catch (e) {
      setAdminUsersErr(e?.message || String(e));
    } finally {
      setAdminUsersBusy(false);
    }
  }

  async function fetchRetestAllowances() {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked || adminRow.role !== "system_admin") return;

    setRetestBusy(true);
    setRetestErr("");
    try {
      const token = await getAccessTokenOrThrow();
      const data = await listRetestAllowances(token);
      setRetestAllowances(data?.allowances || []);
    } catch (e) {
      setRetestErr(e?.message || String(e));
    } finally {
      setRetestBusy(false);
    }
  }

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked) return;
    fetchSubmissions();
    fetchReports();
    if (adminRow.role === "system_admin") {
      fetchAdminUsers();
      fetchRetestAllowances();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, adminRow]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!adminRow || adminRow.blocked) return;
    if (recoveringJobRef.current || busyId || radarJob) return;

    const job = loadActiveReportJob();
    if (!job?.submission_id || Date.now() - Number(job.saved_at || 0) > 30 * 60 * 1000) {
      if (job) clearActiveReportJob();
      return;
    }

    recoveringJobRef.current = true;
    setBusyId(job.report_id || job.submission_id);

    (async () => {
      try {
        const doneData = await waitReportDone(job.submission_id, 2000, 180000);
        openSignedUrl(doneData?.pdf?.url);
        clearActiveReportJob();
        await fetchReports();
      } catch {
        // Keep the job in localStorage so the user can refresh/retry while generation continues.
      } finally {
        recoveringJobRef.current = false;
        setBusyId(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, adminRow, reports.length]);

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
    clearActiveReportJob();
    setSession(null);
    setAdminRow(undefined);
    setSubs([]);
    setReports([]);
    setSelectedReportIds([]);
    setAdminUsers([]);
    setAdminUsersErr("");
    setPreview(null);
    radarApiRef.current = null;

    radarJobApiRef.current = null;
    setRadarJob(null);
    setRadarJobReady(false);
  }

  function toggleReportSelection(reportId) {
    setSelectedReportIds((prev) => {
      if (prev.includes(reportId)) return prev.filter((id) => id !== reportId);
      if (prev.length >= 10) {
        alert("最多一次选择 10 份报告");
        return prev;
      }
      return [...prev, reportId];
    });
  }

  async function startBatchDownload() {
    if (!selectedReportIds.length) {
      alert("请先选择要批量下载的报告");
      return;
    }
    setBatchBusy(true);
    try {
      const token = await getAccessTokenOrThrow();
      const data = await batchDownloadReports(token, selectedReportIds);
      openSignedUrl(data?.zip?.url);
      setSelectedReportIds([]);
    } catch (e) {
      alert("批量下载失败：\n" + (e?.message || String(e)));
    } finally {
      setBatchBusy(false);
    }
  }

  async function downloadExistingReport(reportRow) {
    if (!reportRow?.submission_id) return;
    setBusyId(reportRow.id);
    try {
      const data = await reportSignedUrl(reportRow.submission_id);
      openSignedUrl(data?.pdf?.url);
    } catch (e) {
      alert("下载报告失败：\n" + (e?.message || String(e)));
    } finally {
      setBusyId(null);
    }
  }

  async function submitCreateAdmin(e) {
    e.preventDefault();
    setAdminUsersErr("");
    setAdminUsersBusy(true);
    try {
      const token = await getAccessTokenOrThrow();
      await createAdminUser(token, {
        email: newAdminEmail,
        password: newAdminPassword,
        role: newAdminRole,
      });
      setNewAdminEmail("");
      setNewAdminPassword("");
      setNewAdminRole("report_admin");
      await fetchAdminUsers();
    } catch (err) {
      setAdminUsersErr(err?.message || String(err));
    } finally {
      setAdminUsersBusy(false);
    }
  }

  async function stopAdminUser(userId, emailText) {
    if (!window.confirm(`确认停用管理员账号：${emailText || userId}？`)) return;
    setAdminUsersErr("");
    setAdminUsersBusy(true);
    try {
      const token = await getAccessTokenOrThrow();
      await disableAdminUser(token, userId);
      await fetchAdminUsers();
    } catch (err) {
      setAdminUsersErr(err?.message || String(err));
    } finally {
      setAdminUsersBusy(false);
    }
  }

  async function submitAllowRetest(e) {
    e.preventDefault();
    setRetestErr("");
    setRetestBusy(true);
    try {
      const token = await getAccessTokenOrThrow();
      await allowRetest(token, {
        real_name: retestName,
        company: retestCompany,
        add_count: retestCount,
        note: retestNote,
      });
      setRetestName("");
      setRetestCompany("");
      setRetestCount(1);
      setRetestNote("");
      await fetchRetestAllowances();
    } catch (err) {
      setRetestErr(err?.message || String(err));
    } finally {
      setRetestBusy(false);
    }
  }

  // ============ create report row ============
  async function createReportForSubmission(s) {
    if (!s?.id) return;
    setBusyId(s.id);
    try {
      const existing = reportBySubmissionId.get(s.id);
      if (existing) return;

      const snapshot = buildSnapshotFromSubmission(s);

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

  async function getJson(url, accessToken) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
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

  // ✅ 轮询：直到 /report/status 返回 pdf.url（done）或 error/超时
  async function pollReportUntilReady({ submissionId, accessToken, timeoutMs = 120000, intervalMs = 1200 }) {
    const t0 = Date.now();
    while (true) {
      const url = `${REPORT_API_STATUS_URL}?submission_id=${encodeURIComponent(submissionId)}`;
      const data = await getJson(url, accessToken);

      const r = data?.report;
      const pdfUrl = data?.pdf?.url;

      // done 且有 url
      if (r?.status === "done" && pdfUrl) return { report: r, pdfUrl };

      // error
      if (r?.status === "error") {
        throw new Error(`生成PDF失败：${r?.error || "unknown error"}`);
      }

      // 超时
      if (Date.now() - t0 > timeoutMs) {
        const status = r?.status || "unknown";
        const pdfPath = r?.pdf_path || "";
        throw new Error(
          `PDF 已开始生成但尚未返回下载URL。\nstatus=${status}\npdf_path=${pdfPath}\n\n你可以稍后刷新页面再点“生成PDF(含雷达图)”重试。`
        );
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ✅ 点击“生成PDF(含雷达图)”：启动隐藏雷达 job
  function startGeneratePdfWithRadar(reportRow) {
    const liveSubmission = subs.find((s) => s?.id === reportRow?.submission_id);
    const snap = liveSubmission ? buildSnapshotFromSubmission(liveSubmission) : reportRow?.snapshot || {};
    const { subMap, dimMap } = buildScoreMapsFromSnapshot(snap);
    if (!Object.keys(subMap).length || !Object.keys(dimMap).length) {
      alert("该报告没有可用于雷达图的测评数据，无法生成雷达图");
      return;
    }

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

  // ✅ radarJob 流程：等 ready 后 exportPngAsync → 发后端 /report/generate(异步) → 轮询 /report/status → openSignedUrl
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
          timeoutMs: 12000,
        });

        // 1) 触发后端异步生成（用 REPORT_API_KEY）
        // 把雷达图 PNG 一并传给后端（以及文件名）
        await reportGenerateAsync(reportRow.submission_id, {
          radar_png_data_url: radarPngDataUrl,
          display_file_name: reportRow.file_name || null,
        });
        saveActiveReportJob({ report_id: reportRow.id, submission_id: reportRow.submission_id });

        // 2) 轮询直到 done（拿到 pdf.url）
        const doneData = await waitReportDone(reportRow.submission_id);

        // 3) 打开 signed url
        openSignedUrl(doneData?.pdf?.url);

        // 4) 刷新列表
        await fetchReports();
        clearActiveReportJob();

        alert("PDF 已生成 ✅");
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
          <p style={{ marginTop: 8, marginBottom: 14, color: "#64748b", fontSize: 12 }}>请输入管理员账号（Supabase Auth 用户）</p>

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

            {loginErr ? <div style={{ color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>{loginErr}</div> : <div style={{ minHeight: 16 }} />}

            <button type="submit" style={{ ...btnPrimary, width: "100%", marginTop: 4 }}>
              登录
            </button>

            <div style={{ marginTop: 10, color: "#64748b", fontSize: 11, whiteSpace: "pre-wrap" }}>
              ENV:{"\n"}VITE_SUPABASE_URL={SUPABASE_URL ? "OK" : "MISSING"}
              {"\n"}VITE_SUPABASE_ANON_KEY={SUPABASE_ANON_KEY ? "OK" : "MISSING"}
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

          {adminRow.message ? <div style={{ marginTop: 10, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>{adminRow.message}</div> : null}

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
          <button type="button" style={pill(tab === "submissions")} onClick={() => setTab("submissions")}>
            Submissions
          </button>
          <button type="button" style={pill(tab === "reports")} onClick={() => setTab("reports")}>
            Reports
          </button>
          {adminRow?.role === "system_admin" ? (
            <button type="button" style={pill(tab === "admins")} onClick={() => setTab("admins")}>
              Admin Users
            </button>
          ) : null}
          {adminRow?.role === "system_admin" ? (
            <button type="button" style={pill(tab === "retest")} onClick={() => setTab("retest")}>
              Retest
            </button>
          ) : null}
          <button
            type="button"
            style={{ ...btn, marginLeft: "auto" }}
            onClick={() => {
              fetchSubmissions();
              fetchReports();
              if (adminRow?.role === "system_admin") {
                fetchAdminUsers();
                fetchRetestAllowances();
              }
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
              <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>读取 submissions 失败：{subsErr}</div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {filteredSubs.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>暂无数据</div>
                ) : (
                  filteredSubs.map((s) => {
                    const rep = reportBySubmissionId.get(s.id);
                    const hasReport = !!rep;
                    return (
                      <div key={s.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 800 }}>
                            {s.name || "-"} ｜ {s.company || "-"}
                            <span style={{ marginLeft: 10, color: "#64748b", fontSize: 12, fontWeight: 500 }}>{s.created_at ? new Date(s.created_at).toLocaleString() : ""}</span>
                          </div>

                          {hasReport ? (
                            <span style={{ color: "#64748b", fontSize: 12 }}>已有报告：{rep.status}</span>
                          ) : (
                            <button style={btnPrimary} disabled={busyId === s.id} onClick={() => createReportForSubmission(s)}>
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
        ) : tab === "admins" ? (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800 }}>Admin Users</div>
                <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>system_admin can create or disable admin accounts.</div>
              </div>
              <button type="button" style={btn} disabled={adminUsersBusy} onClick={fetchAdminUsers}>
                {adminUsersBusy ? "Loading..." : "Refresh"}
              </button>
            </div>

            <form onSubmit={submitCreateAdmin} style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.4fr 1fr 180px 120px", gap: 10, alignItems: "end" }}>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Email</div>
                <input
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Initial password</div>
                <input
                  type="password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="at least 8 chars"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Role</div>
                <select
                  value={newAdminRole}
                  onChange={(e) => setNewAdminRole(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14, background: "#fff" }}
                >
                  <option value="report_admin">report_admin</option>
                  <option value="system_admin">system_admin</option>
                </select>
              </label>
              <button type="submit" style={btnPrimary} disabled={adminUsersBusy}>
                Create
              </button>
            </form>

            {adminUsersErr ? <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>{adminUsersErr}</div> : null}

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {adminUsers.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 12 }}>No admin users loaded.</div>
              ) : (
                adminUsers.map((u) => (
                  <div key={u.user_id || u.email} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800 }}>{u.email}</div>
                      <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                        role: {u.role} ｜ status: {u.is_active ? "active" : "disabled"}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={btn}
                      disabled={adminUsersBusy || !u.is_active || u.user_id === session?.user?.id}
                      onClick={() => stopAdminUser(u.user_id, u.email)}
                    >
                      Disable
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : tab === "retest" ? (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800 }}>开放重测 / 提交次数额度</div>
                <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                  默认同一姓名+公司最多提交 5 次。这里每增加 1 次额度，就允许该用户额外提交 1 次，不删除历史报告。
                </div>
              </div>
              <button type="button" style={btn} disabled={retestBusy} onClick={fetchRetestAllowances}>
                {retestBusy ? "Loading..." : "Refresh"}
              </button>
            </div>

            <form onSubmit={submitAllowRetest} style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 120px 1.4fr 120px", gap: 10, alignItems: "end" }}>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>姓名</div>
                <input
                  value={retestName}
                  onChange={(e) => setRetestName(e.target.value)}
                  placeholder="例如：张三"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>公司</div>
                <input
                  value={retestCompany}
                  onChange={(e) => setRetestCompany(e.target.value)}
                  placeholder="必须与问卷填写一致"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>增加次数</div>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={retestCount}
                  onChange={(e) => setRetestCount(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14 }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>备注</div>
                <input
                  value={retestNote}
                  onChange={(e) => setRetestNote(e.target.value)}
                  placeholder="例如：教练确认重测"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14 }}
                />
              </label>
              <button type="submit" style={btnPrimary} disabled={retestBusy}>
                开放重测
              </button>
            </form>

            {retestErr ? <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>{retestErr}</div> : null}

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {retestAllowances.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 12 }}>暂无重测额度记录。</div>
              ) : (
                retestAllowances.map((row) => (
                  <div key={row.id || `${row.real_name}-${row.company}`} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 800 }}>
                        {row.real_name || "-"} ｜ {row.company || "-"}
                      </div>
                      <div style={{ color: row.remaining_submissions > 0 ? "#047857" : "#b91c1c", fontSize: 12, fontWeight: 800 }}>
                        剩余可提交：{row.remaining_submissions ?? "-"} 次
                      </div>
                    </div>
                    <div style={{ marginTop: 6, color: "#64748b", fontSize: 12, lineHeight: 1.7 }}>
                      已提交：{row.submission_count ?? 0} 次 ｜ 基础上限：{row.base_limit ?? 5} 次 ｜ 额外开放：{row.extra_allowed ?? 0} 次 ｜ 当前总上限：
                      {row.max_submissions ?? "-"} 次
                      <br />
                      状态：{row.is_active ? "active" : "disabled"} ｜ updated_at：{row.updated_at ? new Date(row.updated_at).toLocaleString() : "-"}
                      {row.updated_by_email ? ` ｜ 操作人：${row.updated_by_email}` : ""}
                      {row.note ? ` ｜ 备注：${row.note}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Reports（最近 200 条）</div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ color: "#64748b", fontSize: 12 }}>已选：{selectedReportIds.length}/10</span>
                <button type="button" style={btnPrimary} disabled={batchBusy || selectedReportIds.length === 0} onClick={startBatchDownload}>
                  {batchBusy ? "打包中..." : "批量下载"}
                </button>
                {loadingReports ? <div style={{ color: "#64748b", fontSize: 12 }}>加载中…</div> : null}
              </div>
            </div>

            {reportsErr ? (
              <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12, whiteSpace: "pre-wrap" }}>读取 reports 失败：{reportsErr}</div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                {reports.length === 0 ? (
                  <div style={{ color: "#64748b", fontSize: 12 }}>暂无报告（先去 Submissions 创建报告记录）</div>
                ) : (
                  reports.map((r) => {
                    const liveSubmission = subs.find((s) => s?.id === r?.submission_id);
                    const snap = liveSubmission ? buildSnapshotFromSubmission(liveSubmission) : r.snapshot || {};
                    const canBatchDownload = r.status === "done" && !!r.pdf_path;
                    const canPreviewRadar =
                      (Array.isArray(snap?.subscores) && snap.subscores.length > 0) &&
                      (snap?.dimscores && (Array.isArray(snap.dimscores) || typeof snap.dimscores === "object"));

                    return (
                      <div key={r.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                            <input
                              type="checkbox"
                              checked={selectedReportIds.includes(r.id)}
                              disabled={!canBatchDownload}
                              onChange={() => toggleReportSelection(r.id)}
                              title={canBatchDownload ? "选择批量下载" : "只有已生成 PDF 的报告可以批量下载"}
                            />
                            <div style={{ fontWeight: 800 }}>
                              {(snap.name || r.name || "-") + " ｜ " + (snap.company || r.company || "-")}
                              <span style={{ marginLeft: 10, color: "#64748b", fontSize: 12, fontWeight: 500 }}>{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</span>
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            {canPreviewRadar ? (
                              <button
                                style={btn}
                                disabled={busyId === r.id}
                                onClick={() => {
                                  const { subMap, dimMap } = buildScoreMapsFromSnapshot(snap);
                                  radarApiRef.current = null;
                                  setPreview({
                                    reportId: r.id,
                                    submissionId: r.submission_id,
                                    snapshot: snap,
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

                            {r.status === "done" && r.pdf_path ? (
                              <button
                                type="button"
                                style={btnPrimary}
                                disabled={busyId === r.id}
                                onClick={() => downloadExistingReport(r)}
                              >
                                下载PDF
                              </button>
                            ) : null}

                            {r.status === "done" && r.pdf_path ? (
                              <button
                                type="button"
                                style={btn}
                                disabled={busyId === r.id}
                                onClick={() => startGeneratePdfWithRadar(r)}
                                title="重新导出当前雷达PNG，并覆盖生成新版PDF"
                              >
                                {busyId === r.id ? "生成中…" : "重新生成PDF"}
                              </button>
                            ) : null}

                            {r.status !== "done" || !r.pdf_path ? (
                              <button
                                type="button"
                                style={btnPrimary}
                                disabled={busyId === r.id}
                                onClick={() => startGeneratePdfWithRadar(r)}
                                title="导出雷达PNG→后端异步生成PDF→轮询状态→自动打开下载链接"
                              >
                                {busyId === r.id ? "生成中…" : "生成PDF(含雷达图)"}
                              </button>
                            ) : null}
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
