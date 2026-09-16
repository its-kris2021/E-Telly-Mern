import { useState } from "react";
import {
  Waves,
  Mountain,
  CircleDot,
  Wind,
  Tent,
  Layers,
  Sparkles,
  Siren,
  X,
} from "lucide-react";
import RainfallStrip from "../flood/RainfallStrip";

const LAYERS = [
  {
    key: "flood",
    label: "Flood Hazard",
    Icon: Waves,
    activeColor: "bg-blue-500",
    ring: "ring-blue-400",
  },
  {
    key: "typhoon",
    label: "Typhoon",
    Icon: Wind,
    activeColor: "bg-purple-500",
    ring: "ring-purple-400",
  },
  {
    key: "landslide",
    label: "Landslide Hazard",
    Icon: Mountain,
    activeColor: "bg-amber-500",
    ring: "ring-amber-400",
  },
  {
    key: "earthquake",
    label: "Earthquake",
    Icon: CircleDot,
    activeColor: "bg-red-500",
    ring: "ring-red-400",
  },
  {
    key: "reports",
    label: "Live Reports",
    Icon: Siren,
    activeColor: "bg-purple-500",
    ring: "ring-purple-400",
  },
  {
    key: "evacuation",
    label: "Evacuation Centers",
    Icon: Tent,
    activeColor: "bg-green-500",
    ring: "ring-green-400",
  },
  {
    key: "aiPredictions",
    label: "AI Predictions",
    Icon: Sparkles,
    activeColor: "bg-violet-500",
    ring: "ring-violet-400",
  },
];

const LayerControlPanel = ({ layers, onToggleLayer }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeCount = Object.entries(layers).filter(([, v]) => v).length;

  const panelContent = (
    <>
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center justify-between">
        <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
          Layers
        </p>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-gray-400 hover:text-gray-600 p-0.5"
        >
          <X size={13} />
        </button>
      </div>

      <div className="px-3 py-2 flex flex-col gap-1">
        {LAYERS.map(({ key, label, Icon, activeColor, ring, disabled }) => {
          const isOn = layers[key];
          return (
            <button
              key={key}
              disabled={disabled}
              onClick={() => !disabled && onToggleLayer(key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl
                          text-left transition-all duration-150
                          ${
                            disabled
                              ? "opacity-40 cursor-not-allowed"
                              : isOn
                                ? `bg-gray-100 ring-1 ${ring}`
                                : "hover:bg-gray-50 cursor-pointer"
                          }`}
            >
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 transition-all
                              ${!disabled && isOn ? activeColor : "bg-gray-300"}`}
              />
              <Icon
                size={13}
                strokeWidth={1.8}
                className={`flex-shrink-0
                            ${!disabled && isOn ? "text-gray-700" : "text-gray-400"}`}
              />
              <span className="flex-1 text-gray-600 text-xs font-medium">
                {label}
              </span>
              {disabled && (
                <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      <RainfallStrip visible={layers.flood || layers.landslide} />
    </>
  );

  return (
    <>
      {/* Mobile toggle button — hidden on desktop */}
      {!mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden absolute top-[72px] right-4 z-[1001]
                     w-10 h-10 bg-white/95 backdrop-blur border border-gray-200
                     rounded-xl shadow-lg flex items-center justify-center"
        >
          <Layers size={16} className="text-gray-600" />
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white
                             text-[9px] font-bold rounded-full flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </button>
      )}

      {/* Panel — always visible on desktop, toggle on mobile */}
      <div
        className={`absolute top-[72px] right-4 z-[1000] w-56
                    bg-white/95 backdrop-blur border border-gray-200
                    rounded-2xl shadow-lg overflow-hidden
                    ${mobileOpen ? "block" : "hidden"} lg:block`}
      >
        {panelContent}
      </div>
    </>
  );
};

export default LayerControlPanel;
