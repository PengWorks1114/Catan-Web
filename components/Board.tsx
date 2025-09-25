"use client";

import React from "react";

type Terrain = "wood" | "brick" | "sheep" | "wheat" | "ore" | "desert";
type Hex = { id: string; q: number; r: number; type: Terrain; chit?: number };

const COLORS: Record<Terrain, string> = {
  wood: "#7fbf7f",
  brick: "#d97a5d",
  sheep: "#b7e4c7",
  wheat: "#ffe08a",
  ore: "#a1a1aa",
  desert: "#e9d8a6",
};

// 以軸座標(q,r)定義標準 19 塊（外圈 12、中圈 6、中心 1）
// 參考排列：半徑2的蜂巢：sum(|q|,|r|,|s|)<=2 且 q+r+s=0
const LAYOUT: Hex[] = [
  // q,r,type,chit 先放示意，之後可改成從 Firestore/config 載入
  { id: "h1", q: 0, r: 0, type: "desert" },
  { id: "h2", q: 1, r: 0, type: "wood", chit: 8 },
  { id: "h3", q: 1, r: -1, type: "brick", chit: 5 },
  { id: "h4", q: 0, r: -1, type: "sheep", chit: 6 },
  { id: "h5", q: -1, r: 0, type: "wheat", chit: 9 },
  { id: "h6", q: -1, r: 1, type: "ore", chit: 4 },
  { id: "h7", q: 0, r: 1, type: "wood", chit: 10 },
  { id: "h8", q: 2, r: -1, type: "sheep", chit: 3 },
  { id: "h9", q: 2, r: -2, type: "wheat", chit: 11 },
  { id: "h10", q: 1, r: -2, type: "ore", chit: 12 },
  { id: "h11", q: 0, r: -2, type: "wood", chit: 9 },
  { id: "h12", q: -1, r: -1, type: "brick", chit: 4 },
  { id: "h13", q: -2, r: 0, type: "sheep", chit: 3 },
  { id: "h14", q: -2, r: 1, type: "wheat", chit: 8 },
  { id: "h15", q: -1, r: 2, type: "ore", chit: 5 },
  { id: "h16", q: 0, r: 2, type: "wheat", chit: 2 },
  { id: "h17", q: 1, r: 1, type: "sheep", chit: 6 },
  { id: "h18", q: 2, r: 0, type: "brick", chit: 10 },
  { id: "h19", q: -1, r: 1, type: "wood", chit: 11 },
];

// axial 坐標轉平面座標（點頂式 hex）
function axialToPixel(q: number, r: number, size: number) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

// 取得六角形六個頂點
function hexPolygonPoints(cx: number, cy: number, size: number) {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy-top
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
}

// Demo：用簡單圖形表示道路與聚落、城市
type Road = { id: string; x1: number; y1: number; x2: number; y2: number; owner: string };
type Settlement = { id: string; x: number; y: number; owner: string };
type City = { id: string; x: number; y: number; owner: string };

// 簡單示例資料（之後由 Firestore/board 替換）
const DEMO_ROADS: Road[] = [];
const DEMO_SETTLEMENTS: Settlement[] = [];
const DEMO_CITIES: City[] = [];

export default function Board({
  size = 60, // 單格半徑
}: {
  size?: number;
}) {
  // 計算平移讓版圖置中
  const coords = LAYOUT.map((h) => {
    const p = axialToPixel(h.q, h.r, size);
    return { ...h, ...p };
  });
  const minX = Math.min(...coords.map((p) => p.x)) - size;
  const maxX = Math.max(...coords.map((p) => p.x)) + size;
  const minY = Math.min(...coords.map((p) => p.y)) - size;
  const maxY = Math.max(...coords.map((p) => p.y)) + size;
  const width = maxX - minX;
  const height = maxY - minY;

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      className="w-full max-w-[900px] h-auto border rounded-lg bg-white"
    >
      {/* 六角地塊 */}
      {coords.map(({ id, x, y, type, chit }) => (
        <g key={id}>
          <polygon
            points={hexPolygonPoints(x, y, size)}
            fill={COLORS[type]}
            stroke="#333"
            strokeWidth={1.5}
          />
          {/* 文字：資源與點數 */}
          <text x={x} y={y - 4} textAnchor="middle" fontSize={14} fontWeight={600} fill="#222">
            {type.toUpperCase()}
          </text>
          {type !== "desert" && chit != null && (
            <g>
              <rect x={x - 12} y={y + 6} width={24} height={18} rx={4} fill="#fff" stroke="#333" />
              <text x={x} y={y + 20} textAnchor="middle" fontSize={12} fontWeight={700}>
                {chit}
              </text>
            </g>
          )}
        </g>
      ))}

      {/* 道路：灰色粗線 */}
      {DEMO_ROADS.map((r) => (
        <line
          key={r.id}
          x1={r.x1}
          y1={r.y1}
          x2={r.x2}
          y2={r.y2}
          stroke="#555"
          strokeWidth={8}
          strokeLinecap="round"
          opacity={0.85}
        />
      ))}

      {/* 聚落：小方塊 */}
      {DEMO_SETTLEMENTS.map((s) => (
        <rect key={s.id} x={s.x - 8} y={s.y - 8} width={16} height={16} fill="#1d4ed8" />
      ))}

      {/* 城市：大方塊 */}
      {DEMO_CITIES.map((c) => (
        <rect key={c.id} x={c.x - 12} y={c.y - 12} width={24} height={24} fill="#b91c1c" />
      ))}
    </svg>
  );
}
