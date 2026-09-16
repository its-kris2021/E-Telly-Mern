import { useState, useEffect } from "react";
import {
  Droplets,
  Wind,
  Mountain,
  Activity,
  MapPin,
  Siren,
  Sparkles,
  X,
} from "lucide-react";

// ── Legend definitions ────────────────────────────────────────────────────

const FLOOD_LEGEND = {
  key: "flood",
  label: "Flood",
  Icon: Droplets,
  iconColor: "text-blue-500",
  note: "Tile: Phil-LiDAR WMS (25-yr flood hazard) · Source: UP DREAM / DOST",
  rows: [
    { color: "#d32f2f", label: "High Hazard — flood depth > 1.5 m" },
    { color: "#f57c00", label: "Medium Hazard — 0.5 – 1.5 m depth" },
    { color: "#f9a825", label: "Low Hazard — 0.1 – 0.5 m depth" },
  ],
};

const TYPHOON_LEGEND = {
  key: "typhoon",
  label: "Typhoon",
  Icon: Wind,
  iconColor: "text-cyan-500",
  note: "GDACS data · PAGASA 2022 classification",
  rows: [
    { color: "#7c3aed", label: "Super Typhoon (STY) ≥185 km/h" },
    { color: "#dc2626", label: "Typhoon (TY) 118–184 km/h" },
    { color: "#f97316", label: "Severe Tropical Storm (STS) 89–117 km/h" },
    { color: "#f59e0b", label: "Tropical Storm (TS) 62–88 km/h" },
    { color: "#3b82f6", label: "Tropical Depression (TD) <62 km/h" },
  ],
};

const LANDSLIDE_LEGEND = {
  key: "landslide",
  label: "Landslide",
  Icon: Mountain,
  iconColor: "text-amber-500",
  note: "Tile: MGB Landslide Susceptibility (1:10k) · Source: Philippine Geoportal",
  rows: [
    { color: "#d32f2f", label: "High Susceptibility" },
    { color: "#f9a825", label: "Moderate Susceptibility" },
    { color: "#388e3c", label: "Low Susceptibility" },
  ],
};

const EARTHQUAKE_LEGEND = {
  key: "earthquake",
  label: "Earthquake",
  Icon: Activity,
  iconColor: "text-orange-500",
  note: "USGS Earthquake Hazards Program",
  rows: [
    { color: "#b91c1c", label: "M7.0+ Major" },
    { color: "#ef4444", label: "M6.0–6.9 Strong" },
    { color: "#f97316", label: "M5.0–5.9 Moderate" },
    { color: "#eab308", label: "M4.0–4.9 Light" },
    { color: "#06b6d4", label: "M3.0–3.9 Minor" },
    { color: "#6b7280", label: "M<3.0 Micro" },
  ],
};

const REPORTS_LEGEND = {
  key: "reports",
  label: "Reports",
  Icon: Siren,
  iconColor: "text-red-500",
  note: "Marker border = alert severity level",
  rows: [
    { color: "#dc2626", label: "Evacuate — Immediate action required" },
    { color: "#dc2626", label: "Critical — Imminent hazard threat" },
    { color: "#f59e0b", label: "Warning — Elevated risk level" },
    { color: "#3b82f6", label: "Watch — Monitor conditions" },
  ],
};

const EVACUATION_LEGEND = {
  key: "evacuation",
  label: "Evacuation",
  Icon: MapPin,
  iconColor: "text-green-500",
  note: "Evacuation center occupancy status",
  rows: [
    { color: "#22c55e", label: "Active — accepting evacuees" },
    { color: "#f97316", label: "Near Full — 80%+ capacity" },
    { color: "#ef4444", label: "Full — at max capacity" },
    { color: "#94a3b8", label: "Vacant — not activated" },
  ],
};

const AI_PREDICTIONS_LEGEND = {
  key: "aiPredictions",
  label: "AI Predictions",
  Icon: Sparkles,
  iconColor: "text-violet-500",
  note: "Dashed marker = statistical prediction, not a confirmed hazard. Trained on report history + Open-Meteo rainfall/soil moisture.",
  rows: [
    { color: "#dc2626", label: "Critical / Evacuate — high predicted risk" },
    { color: "#f59e0b", label: "Warning — elevated predicted risk" },
    { color: "#3b82f6", label: "Watch — emerging predicted risk" },
  ],
};

const ALL_LEGENDS = [
  FLOOD_LEGEND,
  TYPHOON_LEGEND,
  LANDSLIDE_LEGEND,
  EARTHQUAKE_LEGEND,
  REPORTS_LEGEND,
  EVACUATION_LEGEND,
  AI_PREDICTIONS_LEGEND,
];

// ── HazardLegend ──────────────────────────────────────────────────────────
export default function HazardLegend({ activeLayers }) {
  const active = ALL_LEGENDS.filter((l) => activeLayers[l.key]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const activeKeyString = active.map((l) => l.key).join(",");
  useEffect(() => {
    if (active.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!active.find((l) => l.key === selectedKey))
      setSelectedKey(active[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeyString]);

  if (active.length === 0) return null;

  const compact = active.length >= 3;
  const selected = active.find((l) => l.key === selectedKey) ?? active[0];

  return (
    <div className="absolute bottom-6 left-3 z-[1000] pointer-events-auto" style={{ width: 224 }}>
      {/* Mobile collapsed pill — hidden on sm+ (always expanded there) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="sm:hidden bg-white/95 backdrop-blur border border-gray-200 rounded-xl shadow-md px-3 py-2 flex items-center gap-2"
        >
          <selected.Icon size={14} strokeWidth={2} className={selected.iconColor} />
          <span className="text-[11px] font-semibold text-gray-700">Legend</span>
        </button>
      )}

      {/* Full legend — toggleable on mobile, always visible on sm+ */}
      <div
        className={`bg-white/95 backdrop-blur border border-gray-200 rounded-xl shadow-md overflow-hidden flex-col
                    ${isOpen ? "flex" : "hidden"} sm:flex`}
        style={{ height: 160 }}
      >
        {/* Tab row */}
        <div className="flex border-b border-gray-100 shrink-0">
          {active.map(({ key, label, Icon, iconColor }) => {
            const isSelected = key === (selectedKey ?? active[0].key);
            return (
              <button
                key={key}
                onClick={() => setSelectedKey(key)}
                title={label}
                className={`flex-1 flex items-center justify-center gap-1
                            py-2 text-[10px] font-semibold transition-colors
                            border-b-2 -mb-px
                            ${
                              isSelected
                                ? "border-blue-500 text-gray-700 bg-white"
                                : "border-transparent text-gray-400 bg-gray-50 hover:text-gray-600 hover:bg-white"
                            }`}
              >
                <Icon
                  size={12}
                  strokeWidth={2}
                  className={isSelected ? iconColor : "text-gray-400"}
                />
                {!compact && <span className="truncate">{label}</span>}
              </button>
            );
          })}

          {/* Close button — mobile only */}
          <button
            onClick={() => setIsOpen(false)}
            title="Close legend"
            className="sm:hidden flex items-center justify-center px-2 border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          >
            <X size={12} />
          </button>
        </div>

        {/* Scrollable legend body */}
        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <selected.Icon
              size={11}
              strokeWidth={2}
              className={selected.iconColor}
            />
            <p className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">
              {selected.label}
            </p>
          </div>

          {selected.note && (
            <p className="text-[9px] text-gray-400 mb-2 leading-tight">
              {selected.note}
            </p>
          )}

          <div className="flex flex-col gap-1">
            {selected.rows.map((row) => (
              <div key={row.label} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-[10px] text-gray-600 leading-snug">
                  {row.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
