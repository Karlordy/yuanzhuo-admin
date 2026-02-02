// src/RadarSemiRadar.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import ReactECharts from "echarts-for-react";

/** ---------------- 7维 / 21子项（上4能力=12项；下3限制=9项） ---------------- */
const TOP_SUBS = [
  "使命愿景", "战略关注", "取得成果",   // -> 对应维度：成就导向
  "系统思考", "平衡", "持续产出",       // -> 对应维度：系统意识
  "反思自省", "学习者", "沉着",         // -> 对应维度：自我觉察
  "关爱", "培育", "团队合作"            // -> 对应维度：协同赋能
];

const BOTTOM_SUBS = [
  "取悦", "被动", "保守",               // -> 对应维度：顺从
  "傲慢", "距离感", "挑剔",             // -> 对应维度：防御
  "完美", "专制", "工作狂"               // -> 对应维度：控制
];

const TOP_DIMS = ["成就导向", "系统意识", "自我觉察", "协同赋能"];
const BOTTOM_DIMS = ["顺从", "防御", "控制"];

/** ---------------- 角度计算 ---------------- */
function buildTopSegments() {
  const base = 180;
  const step = 15;
  return TOP_SUBS.map((name, i) => {
    const a0 = base + i * step;
    const a1 = base + (i + 1) * step;
    return { name, a0, a1, mid: (a0 + a1) / 2, group: "top" };
  });
}
function buildBottomSegments() {
  const base = 0;
  const step = 20;
  return BOTTOM_SUBS.map((name, i) => {
    const a0 = base + i * step;
    const a1 = base + (i + 1) * step;
    return { name, a0, a1, mid: (a0 + a1) / 2, group: "bottom" };
  });
}

const DIM_BOUNDARY_ANGLES = [0, 60, 120, 180, 225, 270, 315];

function buildDimLabelAngles() {
  const top = TOP_DIMS.map((d, i) => {
    const a0 = 180 + i * 45;
    const a1 = 180 + (i + 1) * 45;
    return { name: d, mid: (a0 + a1) / 2, group: "top" };
  });
  const bottom = BOTTOM_DIMS.map((d, i) => {
    const a0 = 0 + i * 60;
    const a1 = 0 + (i + 1) * 60;
    return { name: d, mid: (a0 + a1) / 2, group: "bottom" };
  });
  return [...top, ...bottom];
}

/** ---------------- 工具函数 ---------------- */
function toNum(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function fmt2(v) {
  const n = toNum(v);
  return n == null ? "" : n.toFixed(2);
}
function getSubScore(subScoresMap, subName) {
  if (!subScoresMap) return null;
  if (subName in subScoresMap) return toNum(subScoresMap[subName]);
  return null;
}

function polarPixel(coordSys, val0to5, angleDeg, innerRatio = 0.06) {
  const cx = coordSys.cx;
  const cy = coordSys.cy;
  const rMax = coordSys.r;
  const r0 = Math.max(10, rMax * innerRatio);
  const vv = Math.max(0, Math.min(5, val0to5));
  const r = r0 + (vv / 5) * (rMax - r0);
  const a = (angleDeg * Math.PI) / 180;
  const ux = -Math.cos(a);
  const uy = Math.sin(a);
  return { x: cx + ux * r, y: cy + uy * r, ux, uy };
}

function sideByUnitX(ux) { return ux >= 0 ? "right" : "left"; }

/** ---------------- 子项微调 ---------------- */
const SUB_NUDGE = {
  使命愿景: { dxText: 9 }, 战略关注: { dxText: 9, dyText: 3 }, 系统思考: { da: 3 }, 
  平衡: { da: 3 }, 持续产出: { da: 6 }, 反思自省: { da: -6 }, 学习者: { da: -3 }, 
  沉着: { da: -3 }, 培育: { dyText: -3 }, 团队合作: { dxText: -9 },
  取悦: { dxText: -9 }, 傲慢: { da: 6 }, 距离感: { dxText: 35, dxScore: 32 }, 
  挑剔: { da: -6 }, 工作狂: { dxText: 4 },
};

function nudgeFor(name) {
  const n = SUB_NUDGE[name] || {};
  return {
    da: n.da || 0, drText: n.drText || 0, drScore: n.drScore || 0,
    dxText: n.dxText || 0, dyText: n.dyText || 0, dxScore: n.dxScore || 0, dyScore: n.dyScore || 0,
  };
}

/** ---------------- 导出 API ---------------- */
function createExportApi(chartRef) {
  const exportPng = (opts = {}) => {
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!inst) throw new Error("ECharts instance not ready");
    return inst.getDataURL({ type: "png", pixelRatio: 2, ...opts });
  };
  return { exportPng };
}

const RadarSemiRadar = forwardRef(function RadarSemiRadar({ subScores, dimScores, onReady }, ref) {
  if (!subScores || !dimScores) return null;

  const chartRef = useRef(null);
  useImperativeHandle(ref, () => createExportApi(chartRef), []);

  const segments = useMemo(() => {
    const all = [...buildTopSegments(), ...buildBottomSegments()];
    return all.map((seg) => ({ ...seg, score: getSubScore(subScores, seg.name) ?? 0 }));
  }, [subScores]);

  const option = useMemo(() => {
    // 🎨 定义从浅到深的色阶
    const TOP_FILLS = [
      "rgba(37, 99, 235, .15)", // 成就导向 (最浅)
      "rgba(37, 99, 235, .30)", // 系统意识
      "rgba(37, 99, 235, .45)", // 自我觉察
      "rgba(37, 99, 235, .60)", // 协同赋能 (最深)
    ];
    const BOT_FILLS = [
      "rgba(163, 230, 53, .15)", // 顺从 (最浅)
      "rgba(163, 230, 53, .35)", // 防御
      "rgba(163, 230, 53, .55)", // 控制 (最深)
    ];
    const EDGE = "rgba(15, 23, 42, .55)";

    return {
      animation: false,
      polar: { center: ["50%", "52%"], radius: "87%" },
      angleAxis: { type: "value", min: 0, max: 360, startAngle: 180, clockwise: true, show: false },
      radiusAxis: {
        min: 0, max: 5, splitNumber: 5, show: true,
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,.55)" } },
      },
      series: [
        // ① 扇形绘制
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 3,
          data: segments,
          renderItem: (params) => {
            const d = segments[params.dataIndex];
            const { cx, cy, r: rMax } = params.coordSys;
            const r0 = Math.max(10, rMax * 0.06);
            const r1 = r0 + (Math.max(0, Math.min(5, d.score)) / 5) * (rMax - r0);

            // 🎯 根据维度索引分配颜色
            let fill;
            if (d.group === "top") {
              // 上半部分分4段，每段45度
              const dimIdx = Math.floor((d.a0 - 180) / 45);
              fill = TOP_FILLS[Math.min(dimIdx, 3)];
            } else {
              // 下半部分分3段，每段60度
              const dimIdx = Math.floor(d.a0 / 60);
              fill = BOT_FILLS[Math.min(dimIdx, 2)];
            }

            const a0 = Math.PI - (d.a0 * Math.PI) / 180;
            const a1 = Math.PI - (d.a1 * Math.PI) / 180;

            return {
              type: "sector",
              shape: { cx, cy, r0, r: r1, startAngle: a1, endAngle: a0 },
              style: { fill, stroke: EDGE, lineWidth: 1.2 },
            };
          },
        },
        // ② 分隔黑线
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 4,
          data: DIM_BOUNDARY_ANGLES,
          renderItem: (params) => {
            const { cx, cy, r: rMax } = params.coordSys;
            const angDeg = DIM_BOUNDARY_ANGLES[params.dataIndex];
            const r = (angDeg === 0 || angDeg === 180) ? rMax * 1.15 : rMax;
            const a = (angDeg * Math.PI) / 180;
            return {
              type: "line",
              shape: { x1: cx, y1: cy, x2: cx + -Math.cos(a) * r, y2: cy + Math.sin(a) * r },
              style: { stroke: "#000", lineWidth: 2.2 },
            };
          },
        },
        // ③ 分数文字
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 10,
          data: segments,
          renderItem: (params) => {
            const d = segments[params.dataIndex];
            const n = nudgeFor(d.name);
            const p = polarPixel(params.coordSys, 4.2 + n.drScore, d.mid + n.da);
            const side = sideByUnitX(p.ux);
            return {
              type: "text",
              style: {
                x: p.x + p.ux * 10 + (side === "right" ? 6 : -6) + n.dxScore,
                y: p.y + p.uy * 10 + n.dyScore,
                text: fmt2(d.score), fill: "#0f172a", fontSize: 26, fontWeight: 700,
                textAlign: side === "right" ? "left" : "right", textVerticalAlign: "middle",
              },
            };
          },
        },
        // ④ 子项名称
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 11,
          data: segments,
          renderItem: (params) => {
            const d = segments[params.dataIndex];
            const n = nudgeFor(d.name);
            const p = polarPixel(params.coordSys, 4.65 + n.drText, d.mid + n.da);
            const side = sideByUnitX(p.ux);
            return {
              type: "text",
              style: {
                x: p.x + p.ux * 24 + (side === "right" ? 8 : -8) + n.dxText,
                y: p.y + p.uy * 24 + n.dyText,
                text: d.name, fill: "#334155", fontSize: 24,
                textAlign: side === "right" ? "left" : "right", textVerticalAlign: "middle",
              },
            };
          },
        },
        // ⑤ 维度大标签
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 12,
          data: buildDimLabelAngles(),
          renderItem: (params) => {
            const d = buildDimLabelAngles()[params.dataIndex];
            const p = polarPixel(params.coordSys, 2.45, d.mid);
            const score = dimScores?.[d.name];
            return {
              type: "text",
              style: {
                x: p.x, y: p.y, text: `${d.name}\n${fmt2(score)}`,
                fill: "#0f172a", fontSize: 28, fontWeight: 800, lineHeight: 28,
                textAlign: "center", textVerticalAlign: "middle",
              },
            };
          },
        },
      ],
    };
  }, [segments, dimScores]);

  useEffect(() => {
    if (onReady) onReady(createExportApi(chartRef));
  }, [onReady]);

  return (
    <div style={{ width: "100%", height: 950, overflow: "visible" }}>
      <ReactECharts ref={chartRef} option={option} style={{ width: "100%", height: "100%" }} opts={{ renderer: "canvas" }} notMerge={true} />
    </div>
  );
});

export default RadarSemiRadar;
