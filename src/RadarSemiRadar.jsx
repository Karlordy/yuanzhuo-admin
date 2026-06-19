// src/RadarSemiRadar.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import ReactECharts from "echarts-for-react";

/** ---------------- 新32项优先，旧21项自动兼容 ---------------- */
const OLD_MODEL = {
  key: "legacy-21",
  topGroups: [
    { name: "成就导向", subs: ["使命愿景", "战略关注", "取得成果"] },
    { name: "系统意识", subs: ["系统思考", "平衡", "持续产出"] },
    { name: "自我觉察", subs: ["反思自省", "学习者", "沉着"] },
    { name: "协同赋能", subs: ["关爱", "培育", "团队合作"] },
  ],
  bottomGroups: [
    { name: "顺从", subs: ["取悦", "被动", "保守"] },
    { name: "防御", subs: ["傲慢", "距离感", "挑剔"] },
    { name: "控制", subs: ["完美", "专制", "工作狂"] },
  ],
};

const NEW_MODEL = {
  key: "model-32",
  topGroups: [
    { name: "成就导向", subs: ["决断力", "领导效能", "取得成果", "使命愿景", "战略关注"] },
    { name: "系统意识", subs: ["持续性产出", "关心社会", "平衡", "系统思考", "资源统筹"] },
    { name: "自我觉察", subs: ["沉着", "反思自省", "无私领导", "学习者", "正直真实"] },
    { name: "协同赋能", subs: ["关爱", "团队合作", "培育", "人际交往", "协作者"] },
  ],
  bottomGroups: [
    { name: "顺从", subs: ["保守", "被动", "归属", "取悦"] },
    { name: "防御", subs: ["傲慢", "距离感", "挑剔", "自我辩护"] },
    { name: "控制", subs: ["工作狂", "完美", "野心", "专制"] },
  ],
};

const OLD_SUBS = [...OLD_MODEL.topGroups, ...OLD_MODEL.bottomGroups].flatMap((dim) => dim.subs);
const NEW_SUBS = [...NEW_MODEL.topGroups, ...NEW_MODEL.bottomGroups].flatMap((dim) => dim.subs);
const NEW_ONLY_SUBS = NEW_SUBS.filter((name) => !OLD_SUBS.includes(name));

const SCORE_ALIASES = {
  持续性产出: ["持续产出"],
  持续产出: ["持续性产出"],
};

function pickRadarModel(subScoresMap) {
  if (!subScoresMap || typeof subScoresMap !== "object") return OLD_MODEL;
  return NEW_ONLY_SUBS.some((name) => name in subScoresMap) ? NEW_MODEL : OLD_MODEL;
}

function buildSegments(groups, base, span, groupName, reverseSubs = false) {
  const total = groups.reduce((sum, dim) => sum + dim.subs.length, 0);
  const step = span / total;
  let cursor = base;

  return groups.flatMap((dim, dimIndex) =>
    (reverseSubs ? [...dim.subs].reverse() : dim.subs).map((name) => {
      const a0 = cursor;
      const a1 = cursor + step;
      cursor = a1;
      return { name, dim: dim.name, dimIndex, a0, a1, mid: (a0 + a1) / 2, group: groupName };
    })
  );
}

function buildBoundaryAngles(bottomGroups, topGroups) {
  const angles = [];
  let bottomCursor = 0;
  const bottomTotal = bottomGroups.reduce((sum, dim) => sum + dim.subs.length, 0);
  for (const dim of bottomGroups) {
    angles.push(bottomCursor);
    bottomCursor += (dim.subs.length / bottomTotal) * 180;
  }

  let topCursor = 180;
  const topTotal = topGroups.reduce((sum, dim) => sum + dim.subs.length, 0);
  for (const dim of topGroups) {
    angles.push(topCursor);
    topCursor += (dim.subs.length / topTotal) * 180;
  }

  return Array.from(new Set(angles.map((a) => Math.round(a * 100) / 100)));
}

function buildDimLabelAngles(groups, base, span, groupName) {
  const total = groups.reduce((sum, dim) => sum + dim.subs.length, 0);
  let cursor = base;

  return groups.map((dim) => {
    const dimSpan = (dim.subs.length / total) * span;
    const a0 = cursor;
    const a1 = cursor + dimSpan;
    cursor = a1;
    return { name: dim.name, mid: (a0 + a1) / 2, group: groupName };
  });
}

function buildDimSectors(groups, base, span, groupName) {
  const total = groups.reduce((sum, dim) => sum + dim.subs.length, 0);
  let cursor = base;

  return groups.map((dim) => {
    const dimSpan = (dim.subs.length / total) * span;
    const a0 = cursor;
    const a1 = cursor + dimSpan;
    cursor = a1;
    return { name: dim.name, a0, a1, mid: (a0 + a1) / 2, group: groupName };
  });
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
  for (const alias of SCORE_ALIASES[subName] || []) {
    if (alias in subScoresMap) return toNum(subScoresMap[alias]);
  }
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
  使命愿景: { da: 0, drText: 0, drScore: 0, dxText: 9, dyText: 0, dxScore: 0, dyScore: 0 },
  战略关注: { da: 0, drText: 0, drScore: 0, dxText: 9, dyText: 3, dxScore: 0, dyScore: 0 },
  取得成果: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  系统思考: { da: 3, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  平衡: { da: 3, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  持续产出: { da: 6, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  反思自省: { da: -6, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  学习者: { da: -3, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  沉着: { da: -3, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  关爱: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  培育: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: -3, dxScore: 0, dyScore: 0 },
  团队合作: { da: 0, drText: 0, drScore: 0, dxText: -9, dyText: 0, dxScore: 0, dyScore: 0 },

  取悦: { da: 0, drText: 0, drScore: 0, dxText: -9, dyText: 0, dxScore: 0, dyScore: 0 },
  被动: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  保守: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  傲慢: { da: 6, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },

  距离感: { da: 0, drText: 0, drScore: 0, dxText: 35, dyText: 0, dxScore: 32, dyScore: 0 },
  挑剔: { da: -6, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },

  完美: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  专制: { da: 0, drText: 0, drScore: 0, dxText: 0, dyText: 0, dxScore: 0, dyScore: 0 },
  工作狂: { da: 0, drText: 0, drScore: 0, dxText: 4, dyText: 0, dxScore: 0, dyScore: 0 },
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

    const { pixelRatio = 2, excludeComponents = ["toolbox"], backgroundColor } = opts;

    try {
      inst.resize?.();
    } catch {}

    const payload = {
      type: "png",
      pixelRatio,
      excludeComponents,
      ...(backgroundColor != null ? { backgroundColor } : {}), // 不传 => 透明背景
    };

    return inst.getDataURL(payload);
  };

  const exportPngAsync = (opts = {}) => {
    const inst = chartRef.current?.getEchartsInstance?.();
    if (!inst) return Promise.reject(new Error("ECharts instance not ready"));

    const { pixelRatio = 2, excludeComponents = ["toolbox"], backgroundColor, timeoutMs = 3000 } = opts;

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
          const payload = {
            type: "png",
            pixelRatio,
            excludeComponents,
            ...(backgroundColor != null ? { backgroundColor } : {}), // 不传 => 透明背景
          };
          const url = inst.getDataURL(payload);
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

/** ✅ forwardRef：父组件可直接 radarRef.current.exportPng() */
const RadarSemiRadar = forwardRef(function RadarSemiRadar({ subScores, dimScores, onReady }, ref) {
  if (!subScores || !dimScores) return null;

  const chartRef = useRef(null);

  useImperativeHandle(ref, () => createExportApi(chartRef), []);

  const segments = useMemo(() => {
    const model = pickRadarModel(subScores);
    const reverseSubs = model.key === "model-32";
    const all = [
      ...buildSegments(model.topGroups, 180, 180, "top", reverseSubs),
      ...buildSegments(model.bottomGroups, 0, 180, "bottom", reverseSubs),
    ];
    return all.map((seg) => {
      const sc = getSubScore(subScores, seg.name);
      return { ...seg, score: sc == null ? 0 : sc };
    });
  }, [subScores]);

  const hiTopMin3 = useMemo(() => topMin3Names(segments), [segments]);
  const hiBottomMax3 = useMemo(() => bottomMax3Names(segments), [segments]);

  const isNewRadar = segments.length > 21;
  const R_SCORE = isNewRadar ? 4.26 : 4.2;
  const R_TEXT = isNewRadar ? 4.82 : 4.65;
  const R_DIM = isNewRadar ? 2.35 : 2.45;
  const SCORE_OUT_PX = isNewRadar ? 8 : 10;
  const TEXT_OUT_PX = isNewRadar ? 20 : 24;

  const option = useMemo(() => {
    const TOP_DIM_FILLS = [
      "rgba(37, 99, 235, 0.18)",
      "rgba(37, 99, 235, 0.26)",
      "rgba(37, 99, 235, 0.34)",
      "rgba(37, 99, 235, 0.42)",
    ];
    const TOP_DIM_FILLS_HI = [
      "rgba(30, 64, 175, 0.38)",
      "rgba(30, 64, 175, 0.46)",
      "rgba(30, 64, 175, 0.54)",
      "rgba(30, 64, 175, 0.62)",
    ];
    const BOT_DIM_FILLS = [
      "rgba(132, 204, 22, 0.18)",
      "rgba(132, 204, 22, 0.28)",
      "rgba(132, 204, 22, 0.38)",
    ];
    const BOT_DIM_FILLS_HI = [
      "rgba(77, 124, 15, 0.38)",
      "rgba(77, 124, 15, 0.50)",
      "rgba(77, 124, 15, 0.62)",
    ];
    const EDGE = "rgba(15, 23, 42, .55)";
    const DIM_AVG_OUTLINE = "#c00000";
    const DIVIDER_LEN = 1;

    const model = pickRadarModel(subScores);
    const dimAngles = [
      ...buildDimLabelAngles(model.topGroups, 180, 180, "top"),
      ...buildDimLabelAngles(model.bottomGroups, 0, 180, "bottom"),
    ];
    const dimSectors = [
      ...buildDimSectors(model.topGroups, 180, 180, "top"),
      ...buildDimSectors(model.bottomGroups, 0, 180, "bottom"),
    ];
    const dimBoundaryAngles = buildBoundaryAngles(model.bottomGroups, model.topGroups);
    const scoreFontSize = isNewRadar ? 18 : 26;
    const subFontSize = isNewRadar ? 16 : 24;
    const dimFontSize = isNewRadar ? 23 : 28;
    const dimLineHeight = isNewRadar ? 24 : 28;

    return {
      animation: false,
      legend: { show: false },

      // ✅ 关键修改：radius 调到 85%
      polar: { center: ["50%", "52%"], radius: "87%" },

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
            const fill = isTop
              ? (isHi ? TOP_DIM_FILLS_HI[d.dimIndex] : TOP_DIM_FILLS[d.dimIndex]) || TOP_DIM_FILLS[0]
              : (isHi ? BOT_DIM_FILLS_HI[d.dimIndex] : BOT_DIM_FILLS[d.dimIndex]) || BOT_DIM_FILLS[0];

            const a0 = Math.PI - (d.a0 * Math.PI) / 180;
            const a1 = Math.PI - (d.a1 * Math.PI) / 180;

            return {
              type: "sector",
              shape: { cx, cy, r0, r: r1, startAngle: a1, endAngle: a0 },
              style: { fill, stroke: EDGE, lineWidth: 1.2 },
            };
          },
        },

        // ② 7大维度平均分描边
        {
          name: "维度平均分描边",
          type: "custom",
          coordinateSystem: "polar",
          z: 8,
          clip: false,
          data: dimSectors,
          tooltip: { show: false },
          renderItem: (params) => {
            const d = dimSectors[params.dataIndex];
            const coordSys = params.coordSys;
            if (!d || !coordSys) return null;

            const cx = coordSys.cx;
            const cy = coordSys.cy;
            const rMax = coordSys.r;
            const score = toNum(dimScores?.[d.name]) ?? 0;
            const r = (Math.max(0, Math.min(5, score)) / 5) * rMax;
            const startAngle = Math.PI - (d.a1 * Math.PI) / 180;
            const endAngle = Math.PI - (d.a0 * Math.PI) / 180;

            return {
              type: "sector",
              shape: { cx, cy, r0: 0, r, startAngle, endAngle },
              style: {
                fill: "rgba(0,0,0,0)",
                stroke: DIM_AVG_OUTLINE,
                lineWidth: isNewRadar ? 5 : 4,
              },
              silent: true,
            };
          },
        },

        // ③ 分隔线 (🟢 修改处：延长水平线)
        {
          type: "custom",
          coordinateSystem: "polar",
          z: 2,
          clip: false,
          data: dimBoundaryAngles,
          tooltip: { show: false },
          renderItem: (params) => {
            const coordSys = params.coordSys;
            if (!coordSys) return null;

            const angDeg = dimBoundaryAngles[params.dataIndex] ?? 0;
            const cx = coordSys.cx;
            const cy = coordSys.cy;

            // 🟢 修改逻辑：如果是 0° 或 180°（水平线），则倍数设为 1.15，否则 1.0
            const isHorizontal = angDeg === 0 || angDeg === 180;
            const lenFactor = isHorizontal ? 1.15 : DIVIDER_LEN;

            const r = coordSys.r * lenFactor;

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

        // ④ 分数文字
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

            const n = isNewRadar ? nudgeFor("") : nudgeFor(d.name);
            const ang = d.mid + n.da;
            const rVal = R_SCORE + n.drScore;

            const p = polarPixel(coordSys, rVal, ang);
            const side = sideByUnitX(p.ux);

            return {
              type: "text",
              style: {
                x: p.x + p.ux * SCORE_OUT_PX + (isNewRadar ? 0 : side === "right" ? 6 : -6) + n.dxScore,
                y: p.y + p.uy * SCORE_OUT_PX + n.dyScore,
                text: fmt2(d.score),
                fill: "#0f172a",
                fontSize: scoreFontSize,
                fontWeight: 700,
                textAlign: side === "right" ? "left" : "right",
                textVerticalAlign: "middle",
              },
            };
          },
        },

        // ⑤ 子项文字
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

            const n = isNewRadar ? nudgeFor("") : nudgeFor(d.name);
            const ang = d.mid + n.da;
            const rVal = R_TEXT + n.drText;

            const p = polarPixel(coordSys, rVal, ang);
            const side = sideByUnitX(p.ux);

            return {
              type: "text",
              style: {
                x: p.x + p.ux * TEXT_OUT_PX + (isNewRadar ? 0 : side === "right" ? 8 : -8) + n.dxText,
                y: p.y + p.uy * TEXT_OUT_PX + n.dyText,
                text: d.name,
                fill: "#334155",
                fontSize: subFontSize,
                textAlign: side === "right" ? "left" : "right",
                textVerticalAlign: "middle",
              },
            };
          },
        },

        // ⑥ 维度文字
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
                fontSize: dimFontSize,
                fontWeight: 800,
                lineHeight: dimLineHeight,
                textAlign: "center",
                textVerticalAlign: "middle",
              },
            };
          },
        },
      ],
    };
  }, [segments, subScores, dimScores, hiTopMin3, hiBottomMax3, isNewRadar]);

  // 继续支持 onReady(api)
  useEffect(() => {
    if (typeof onReady !== "function") return;
    const api = createExportApi(chartRef);
    onReady(api);
    return () => onReady(null);
  }, [onReady]);

  return (
    <div style={{ width: "100%", height: 950, overflow: "visible" }}>
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
