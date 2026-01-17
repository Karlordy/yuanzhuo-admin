import React, { useMemo } from "react";

/**
 * Template B - 卡片式报告预览（前端）
 * props:
 *  - snapshot: reports.snapshot（包含 name/company/subscores/dimscores/focus_low3/focus_high2/insight_text/...）
 *  - radarPngDataUrl: 可选，RadarSemiRadar 导出的 data:image/png;base64,...
 */
export default function ReportTemplate({ snapshot, radarPngDataUrl }) {
  const data = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);

  const css = `
  :root{
    --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#ffffff;
    --soft:#f8fafc; --soft2:#f1f5f9; --accent:#7c3aed;
    --lowBg: rgba(220,38,38,.06); --lowBd: rgba(220,38,38,.18);
    --highBg: rgba(22,163,74,.06); --highBd: rgba(22,163,74,.18);
  }
  *{box-sizing:border-box;}
  .wrap{background:#f1f5f9;padding:12px;border-radius:16px;border:1px solid var(--line);}
  .page{
    width: 900px; max-width: 100%;
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 12px 30px rgba(2,6,23,.08);
    border-radius: 16px;
    padding: 18px;
    color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",Arial,sans-serif;
  }
  .header{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:1px solid var(--line);}
  .brand{display:flex;gap:10px;align-items:center;}
  .logo{
    width:36px;height:36px;border-radius:10px;
    background: linear-gradient(135deg, rgba(124,58,237,.25), rgba(124,58,237,.05));
    border: 1px solid rgba(124,58,237,.25);
    display:flex;align-items:center;justify-content:center;
    color: var(--accent);font-weight:900;letter-spacing:.5px;
  }
  .title h1{margin:0;font-size:18px;letter-spacing:.4px;}
  .title .sub{margin-top:2px;font-size:12px;color:var(--muted);}
  .meta{text-align:right;font-size:12px;color:var(--muted);line-height:1.55;}
  .meta b{color:var(--ink);font-weight:700;}

  .infoBar{
    margin-top: 14px;
    background: var(--soft);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px;
    display:grid;
    grid-template-columns: 1.1fr 1.4fr 1fr;
    gap:10px;
    font-size: 12px;
    color: var(--muted);
  }
  .infoBar .item b{display:block;color:var(--ink);font-size:13px;margin-top:2px;}

  .grid2{
    display:grid;
    grid-template-columns: 1.85fr 0.60fr;
    gap: 14px;
    margin-top: 14px;
    align-items: stretch;
  }
  .card{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff;}
  .card h2{margin:0 0 8px 0;font-size:13px;letter-spacing:.2px;}

  .radarWrap{height: 380px;display:flex;align-items:center;justify-content:center;background:#fff;}
  .radarInner{
    width:100%;height:100%;
    border: 1px dashed rgba(148,163,184,.9);
    border-radius:14px;
    display:flex;align-items:center;justify-content:center;
    color: var(--muted);
    position:relative; overflow:hidden;
  }
  .radarInner img{max-width:96%;max-height:96%;display:block;}
  .note{position:absolute;bottom:10px;left:12px;font-size:11px;color:var(--muted);}

  .rightStack{display:flex;flex-direction:column;gap:14px;height:100%;}
  .kpi{border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:var(--soft);}
  .kpi .label{font-size:12px;color:var(--muted);font-weight:800;}
  .kpi .value{margin-top:10px;font-size:24px;font-weight:900;letter-spacing:.3px;color:var(--ink);display:flex;align-items:baseline;gap:8px;line-height:1.1;}
  .kpi .value span{font-size:14px;font-weight:800;color:var(--muted);}
  .list{margin-top:8px;display:flex;flex-direction:column;gap:8px;font-size:13px;}
  .row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(226,232,240,.9);background:#fff;}
  .row .name{color:var(--ink);font-weight:800;}
  .row .val{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:900;}

  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
  .chip{
    display:inline-flex;align-items:center;gap:6px;
    padding:7px 10px;border-radius:999px;
    border:1px solid rgba(124,58,237,.25);
    background: rgba(124,58,237,.08);
    font-size:12.5px;color:var(--ink);font-weight:800;
  }
  .chip.low{border-color:rgba(220,38,38,.25);background:rgba(220,38,38,.08);}
  .chip.high{border-color:rgba(22,163,74,.25);background:rgba(22,163,74,.08);}

  .section{margin-top:14px;}
  .sectionTitle{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px;}
  .sectionTitle h3{margin:0;font-size:14px;letter-spacing:.2px;}
  .sectionTitle .hint{font-size:12px;color:var(--muted);}

  .summary{
    border:1px solid rgba(124,58,237,.18);
    border-radius:16px;
    padding:14px 14px;
    background: linear-gradient(180deg, rgba(124,58,237,.08), rgba(124,58,237,.03));
    line-height:1.85;
    font-size:13px;
    color: var(--ink);
    font-weight:650;
    white-space:pre-wrap;
  }
  .footer{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.6;}
  `;

  return (
    <div className="wrap">
      <style>{css}</style>
      <section className="page">
        <div className="header">
          <div className="brand">
            <div className="logo">圆桌</div>
            <div className="title">
              <h1>领导力测评报告</h1>
              <div className="sub">模板B｜摘要 + 明细（卡片式）</div>
            </div>
          </div>
          <div className="meta">
            报告日期：<b>{data.reportDate}</b>
            <br />
            量表：<b>1.00～5.00（保留两位小数）</b>
          </div>
        </div>

        <div className="infoBar">
          <div className="item">
            姓名<b>{data.name || "-"}</b>
          </div>
          <div className="item">
            公司<b>{data.company || "-"}</b>
          </div>
          <div className="item">
            测评时间<b>{data.submittedAt || "-"}</b>
          </div>
        </div>

        <div className="grid2">
          <div style={{ display: "grid", gap: 12 }}>
            <div className="card">
              <h2>领导力雷达图（7维 / 21子项）</h2>
              <div className="radarWrap">
                <div className="radarInner">
                  {radarPngDataUrl ? (
                    <img src={radarPngDataUrl} alt="radar" />
                  ) : (
                    <div style={{ fontSize: 12 }}>（请先点“生成报告预览PNG”）</div>
                  )}
                  <div className="note">PDF 中会嵌入与你网页预览一致的雷达图 PNG。</div>
                </div>
              </div>
            </div>

            <div className="card">
              <h2>关键关注点</h2>

              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 900 }}>最低3项（能力项）</div>
              <div className="chips">
                {data.low3.map((it) => (
                  <span className="chip low" key={`low-${it.name}`}>
                    {it.name} {fmt2(it.score)}
                  </span>
                ))}
                {data.low3.length === 0 ? <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span> : null}
              </div>

              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 900, marginTop: 10 }}>
                最高2项（限制项）
              </div>
              <div className="chips">
                {data.high2.map((it) => (
                  <span className="chip high" key={`high-${it.name}`}>
                    {it.name} {fmt2(it.score)}
                  </span>
                ))}
                {data.high2.length === 0 ? <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span> : null}
              </div>

              <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
                说明：能力项取最低3；限制项取最高2，用于反映当前最需要被关注的结构特征。
              </div>
            </div>
          </div>

          <div className="rightStack">
            <div className="kpi">
              <div className="label">综合得分</div>
              <div className="value">
                {fmt2(data.overall)} <span>/ 5.00</span>
              </div>
            </div>

            <div className="card" style={{ flex: 1 }}>
              <h2 style={{ fontSize: 13 }}>7大维度得分</h2>
              <div className="list">
                {data.dimList.map((d) => (
                  <div className="row" key={d.name}>
                    <div className="name">{d.name}</div>
                    <div className="val">{fmt2(d.score)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="sectionTitle">
            <h3>洞察摘要</h3>
            <div className="hint">控制在 3～4 行，仅做现状分析</div>
          </div>
          <div className="summary">{data.insightText || "—"}</div>
        </div>

        <div className="footer">
          <div>保密提示：本报告仅供本人及教练团队用于成长辅导与复盘，不建议公开传播。</div>
          <div>
            量表口径：所有得分均为 1.00～5.00，数值越高代表该特质表现越明显；限制项得分越高代表压力情境下该模式出现的概率越高。
          </div>
        </div>
      </section>
    </div>
  );
}

function fmt2(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  return "-";
}

function normalizeSnapshot(snapshot) {
  const s = snapshot || {};
  const name = String(s.name ?? "").trim();
  const company = String(s.company ?? "").trim();

  // dimscores: object or array
  const dimMap = {};
  const rawDims = s.dimscores;
  if (rawDims && typeof rawDims === "object" && !Array.isArray(rawDims)) {
    for (const [k, v] of Object.entries(rawDims)) dimMap[String(k).trim()] = numOrNull(v);
  } else if (Array.isArray(rawDims)) {
    for (const it of rawDims) {
      const dimName = String(it?.dim ?? it?.dimName ?? it?.name ?? it?.label ?? "").trim();
      if (!dimName) continue;
      dimMap[dimName] = numOrNull(it?.score ?? it?.value ?? it?.avg ?? it?.mean);
    }
  }

  const dimOrder = ["成就导向", "系统意识", "自我觉察", "协同赋能", "顺从", "防御", "控制"];
  const dimList = dimOrder.map((d) => ({ name: d, score: dimMap[d] }));

  const dimVals = dimOrder.map((d) => dimMap[d]).filter((x) => typeof x === "number");
  const overall = dimVals.length ? round2(dimVals.reduce((a, b) => a + b, 0) / dimVals.length) : null;

  const low3 = normalizeFocus(s.focus_low3);
  const high2 = normalizeFocus(s.focus_high2);

  return {
    name,
    company,
    submittedAt: formatDateTime(s.submission_created_at || s.created_at || ""),
    reportDate: formatDateOnly(new Date()),
    overall,
    dimList,
    low3,
    high2,
    insightText: (s.insight_text ? String(s.insight_text) : "").trim(),
  };
}

function normalizeFocus(x) {
  if (!x) return [];
  const arr = Array.isArray(x) ? x : [x];
  const out = [];
  for (const it of arr) {
    if (typeof it === "string") out.push({ name: it, score: null });
    else if (typeof it === "object" && it) {
      const name = String(it.sub ?? it.name ?? it.label ?? "").trim() || String(it.title ?? "").trim();
      out.push({ name: name || "—", score: numOrNull(it.score ?? it.value) });
    }
  }
  return out.filter((a) => a.name && a.name !== "—");
}

function numOrNull(v) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? round2(n) : null;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatDateOnly(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function formatDateTime(iso) {
  try {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
      d.getMinutes()
    )}`;
  } catch {
    return String(iso || "");
  }
}
