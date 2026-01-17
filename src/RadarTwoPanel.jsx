import { useMemo } from "react";
import RadarSemiRadar from "./RadarSemiRadar";

/**
 * snapshot 来自 reports.snapshot，结构示例：
 * {
 *   name, company,
 *   dimscores: { "成就导向": 3.88, ... },
 *   subscores: [ { dim:"成就导向", sub:"使命愿景", score:4.33 }, ... ]  // 21条
 * }
 */
export default function RadarTwoPanel({ snapshot }) {
  const subScoresMap = useMemo(() => {
    const arr = snapshot?.subscores;
    if (!Array.isArray(arr)) return null;

    const m = {};
    for (const it of arr) {
      const sub = it?.sub;
      const score = it?.score;
      if (!sub) continue;

      // 只保留有效数字，并保留2位小数
      if (typeof score === "number" && Number.isFinite(score)) {
        m[sub] = Number(score.toFixed(2));
      } else {
        m[sub] = null;
      }
    }

    // 兼容老字段：如果你库里还存着 “工作狂/野心”，也映射成“工作狂”
    if (m["工作狂"] == null && m["工作狂/野心"] != null) {
      m["工作狂"] = m["工作狂/野心"];
    }

    return m;
  }, [snapshot]);

  const dimScoresMap = useMemo(() => {
    const obj = snapshot?.dimscores;
    if (!obj || typeof obj !== "object") return null;

    const m = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number" && Number.isFinite(v)) m[k] = Number(v.toFixed(2));
      else m[k] = null;
    }
    return m;
  }, [snapshot]);

  if (!subScoresMap || !dimScoresMap) {
    return (
      <div style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
        雷达图数据缺失：snapshot.subscores / snapshot.dimscores 不完整
      </div>
    );
  }

  return <RadarSemiRadar subScores={subScoresMap} dimScores={dimScoresMap} />;
}
