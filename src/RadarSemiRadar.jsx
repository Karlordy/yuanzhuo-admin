// RadarSemiRadar.jsx
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
  "使命愿景",
  "战略关注",
  "取得成果",
  "系统思考",
  "平衡",
  "持续产出",
  "反思自省",
  "学习者",
  "沉着",
  "关爱",
  "培育",
  "团队合作",
];

const BOTTOM_SUBS = ["取悦", "被动", "保守", "傲慢", "距离感", "挑剔", "完美", "专制", "工作狂"];

const TOP_DIMS = ["成就导向", "系统意识", "自我觉察", "协同赋能"];
const BOTTOM_DIMS = ["顺从", "防御", "控制"];

/** ---------------- 角度：上半180~360(12*15°)，下半0~180(9*20°) ---------------- */
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

/** 7根分隔线角度（上4下3） */
const DIM_BOUNDARY_ANGLES = [0, 60, 120, 180, 225, 270, 315];

/** dim 标签角度（段中心） */
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

/** ---------------- 工具 ---------------- */
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

/** 我们自己的 polar->pixel（不依赖 api.coord，避免顺序坑） */
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

function sideByUnitX(ux) {
  return ux >= 0 ? "right" : "left";
}

/** 高亮规则：上半球取最小3；下半球取最大3 */
function topMin3Names(items) {
  const top = items.filter((x) => x.group === "top");
  const sorted = [...top].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return new Set(sorted.slice(0, 3).map((x) => x.name));
}
function bottomMax3Names(items) {
  const bottom = items.filter((x) => x.group === "bottom");
  const sorted = [...bottom].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return new Set(sorted.slice(0, 3).map((x) => x.name));
}

/** 子项微调 */
const SUB_NUDGE = {
  使命愿景: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  战略关注: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  取得成果: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  系统思考: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  平衡: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  持续产出: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  反思自省: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  学习者: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  沉着: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  关爱: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  培育: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  团队合作: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },

  取悦: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  被动: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  保守: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  傲慢: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },

  距离感: { da: 0, drText: 0, drScore: 0, dxText: 15, dyText: 0, dxScore: 0, dyScore: 0 },
  挑剔: { da: -6, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },

  完美: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  专制: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  工作狂: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
};

function nudgeFor(name) {
  const n = SUB_NUDGE[name] || {};
  return {
    da: n.da || 0,
    drText: n.drText || 0,
    drScore: n.drScore || 0,
    dxText: n.dxText ?? n.dx ?? 0,
    dyText: n.dyText ?? n.dy ?? 0,
    dxScore: n.dxScore || 0,
    dyScore: n.dyScore || 0,
  };
}

/** ---------------- 导出 PNG：给父组件 ref / onReady 两种方式同时支持 ---------------- */
function createExportApi(chartRef) {
  const exportPng = (opts = {}) => {
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!inst) throw new Error("ECharts instance not ready");

    const { pixelRatio = 2, backgroundColor = "#ffffff", excludeComponents = ["toolbox"] } = opts;

    // 双保险：避免隐藏容器尺寸/首帧问题
    try {
      inst.resize?.();
    } catch {}

    return inst.getDataURL({
      type: "png",
      pixelRatio,
      backgroundColor,
      excludeComponents,
    });
  };

  const exportPngAsync = (opts = {}) => {
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!inst) return Promise.reject(new Error("ECharts instance not ready"));

    const {
      pixelRatio = 2,
      backgroundColor = "#ffffff",
      excludeComponents = ["toolbox"],
      timeoutMs = 3000,
    } = opts;

    return new Promise((resolve, reject) => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        try {
          inst.off?.("finished", finish);
        } catch {}

        try {
          inst.resize?.();
          const url = inst.getDataURL({
            type: "png",
            pixelRatio,
            backgroundColor,
            excludeComponents,
          });
          resolve(url);
        } catch (e) {
          reject(e);
        }
      };

      try {
        inst.on?.("finished", finish);
      } catch {}

      requestAnimationFrame(() => requestAnimationFrame(finish));

      setTimeout(() => {
        if (!done) {
          try {
            inst.off?.("finished", finish);
          } catch {}
          reject(new Error("exportPngAsync timeout"));
        }
      }, timeoutMs);
    });
  };

  return { exportPng, exportPngAsync };
}

/** ✅ 改为 forwardRef：父组件可直接 radarRef.current.exportPng() */
const RadarSemiRadar = forwardRef(function RadarSemiRadar({ subScores, dimScores, onReady }, ref) {
  if (!subScores || !dimScores) return null;

  const chartRef = useRef(null);

  // 1) 暴露给父组件 ref
  useImperativeHandle(ref, () => createExportApi(chartRef), []);

  const segments = useMemo(() => {
    const all = [...buildTopSegments(), ...buildBottomSegments()];
    return all.map((seg) => {
      const sc = getSubScore(subScores, seg.name);
      return { ...seg, score: sc == null ? 0 : sc };
    });
  }, [subScores]);

  const hiTopMin3 = useMemo(() => topMin3Names(segments), [segments]);
  const hiBottomMax3 = useMemo(() => bottomMax3Names(segments), [segments]);

  const R_SCORE = 4.2;
  const R_TEXT = 4.65;
  const R_DIM = 2.45;
  const SCORE_OUT_PX = 10;
  const TEXT_OUT_PX = 24;

  const option = useMemo(() => {
    const TOP_FILL = "rgba(37, 99, 235, .32)";
    const TOP_FILL_HI = "rgba(30, 64, 175, .62)";
    const BOT_FILL = "rgba(163, 230, 53, .32)";
    const BOT_FILL_HI = "rgba(77, 124, 15, .62)";
    const EDGE = "rgba(15, 23, 42, .55)";
    const DIVIDER_LEN = 1;

    const dimAngles = buildDimLabelAngles();

    return {
      animation: false,
      legend: { show: false },

      polar: { center: ["50%", "60%"], radius: "66%" },

      angleAxis: {
        type: "value",
        min: 0,
        max: 360,
        startAngle: 180,
        clockwise: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },

      radiusAxis: {
        min: 0,
        max: 5,
        splitNumber: 5,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,.55)" } },
      },

      series: [
        // ① 扇形
        {
          name: "子项（扇形）",
          type: "custom",
          coordinateSystem: "polar",
          z: 3,
          clip: false,
          data: segments,
          renderItem: (params) => {
            const d = segments[params.dataIndex];
            const coordSys = params.coordSys;
            if (!d || !coordSys) return null;

            const cx = coordSys.cx;
            const cy = coordSys.cy;
            const rMax = coordSys.r;

            const score = typeof d.score === "number" ? d.score : 0;
            const r0 = Math.max(10, rMax * 0.06);
            const r1 = r0 + (Math.max(0, Math.min(5, score)) / 5) * (rMax - r0);

            const isTop = d.group === "top";
            const isHi = (isTop && hiTopMin3.has(d.name)) || (!isTop && hiBottomMax3.has(d.name));
            const fill = isTop ? (isHi ? TOP_FILL_HI : TOP_FILL) : isHi ? BOT_FILL_HI : BOT_FILL;

            const a0 = Math.PI - (d.a0 * Math.PI) / 180;
            const a1 = Math.PI - (d.a1 * Math.PI) / 180;

            return {
              type: "sector",
              shape: { cx, cy, r0, r: r1, startAngle: a1, endAngle: a0 },
              style: { fill, stroke: EDGE, lineWidth: 1.2 },
            };
          },
        },

        // ② 分隔线
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 2,
          clip: false,
          data: DIM_BOUNDARY_ANGLES,
          tooltip: { show: false },
          renderItem: (params) => {
            const coordSys = params.coordSys;
            if (!coordSys) return null;

            const angDeg = DIM_BOUNDARY_ANGLES[params.dataIndex] ?? 0;
            const cx = coordSys.cx;
            const cy = coordSys.cy;
            const r = coordSys.r * DIVIDER_LEN;

            const a = (angDeg * Math.PI) / 180;
            const x = cx + -Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;

            return {
              type: "line",
              shape: { x1: cx, y1: cy, x2: x, y2: y },
              style: { stroke: "#000", lineWidth: 2.2 },
            };
          },
        },

        // ③ 分数文字
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 10,
          clip: false,
          data: segments,
          tooltip: { show: false },
          renderItem: (params) => {
            const d = segments[params.dataIndex];
            const coordSys = params.coordSys;
            if (!d || !coordSys) return null;

            const n = nudgeFor(d.name);
            const ang = d.mid + n.da;
            const rVal = R_SCORE + n.drScore;

            const p = polarPixel(coordSys, rVal, ang);
            const side = sideByUnitX(p.ux);

            return {
              type: "text",
              style: {
                x: p.x + p.ux * SCORE_OUT_PX + (side === "right" ? 6 : -6) + n.dxScore,
                y: p.y + p.uy * SCORE_OUT_PX + n.dyScore,
                text: fmt2(d.score),
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: 700,
                textAlign: side === "right" ? "left" : "right",
                textVerticalAlign: "middle",
              },
            };
          },
        },

        // ④ 子项文字
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 11,
          clip: false,
          data: segments,
          tooltip: { show: false },
          renderItem: (params) => {
            const d = segments[params.dataIndex];
            const coordSys = params.coordSys;
            if (!d || !coordSys) return null;

            const n = nudgeFor(d.name);
            const ang = d.mid + n.da;
            const rVal = R_TEXT + n.drText;

            const p = polarPixel(coordSys, rVal, ang);
            const side = sideByUnitX(p.ux);

            return {
              type: "text",
              style: {
                x: p.x + p.ux * TEXT_OUT_PX + (side === "right" ? 8 : -8) + n.dxText,
                y: p.y + p.uy * TEXT_OUT_PX + n.dyText,
                text: d.name,
                fill: "#334155",
                fontSize: 12,
                textAlign: side === "right" ? "left" : "right",
                textVerticalAlign: "middle",
              },
            };
          },
        },

        // ⑤ 维度文字
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 12,
          clip: false,
          data: dimAngles,
          tooltip: { show: false },
          renderItem: (params) => {
            const d = dimAngles[params.dataIndex];
            const coordSys = params.coordSys;
            if (!d || !coordSys) return null;

            const p = polarPixel(coordSys, R_DIM, d.mid);
            const score = dimScores?.[d.name];

            return {
              type: "text",
              style: {
                x: p.x,
                y: p.y,
                text: `${d.name}\n${fmt2(score)}`,
                fill: "#0f172a",
                fontSize: 13,
                fontWeight: 800,
                lineHeight: 16,
                textAlign: "center",
                textVerticalAlign: "middle",
              },
            };
          },
        },
      ],
    };
  }, [segments, dimScores, hiTopMin3, hiBottomMax3]);

  // 2) 继续支持你原来的 onReady(api) 方式
  useEffect(() => {
    if (typeof onReady !== "function") return;

    const api = createExportApi(chartRef);
    onReady(api);
    return () => onReady(null);
  }, [onReady]);

  return (
    <div style={{ width: "100%", height: 820, overflow: "visible" }}>
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge={true}
        lazyUpdate={false}
      />
    </div>
  );
});

export default RadarSemiRadar;
