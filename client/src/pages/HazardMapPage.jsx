import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "leaflet/dist/leaflet.css";
import "../utils/fixLeafletIcons";
import { useMap } from "react-leaflet";
import {
  Crosshair,
  Map,
  MapPin,
  Maximize2,
  Minimize2,
} from "lucide-react";

// core
import BaseMap from "../components/map/core/BaseMap";
import LayerControlPanel from "../components/map/core/LayerControlPanel";
import MapStatusBar from "../components/map/core/MapStatusBar";

// flood
import { UserLocationMarker } from "../components/map/flood/FloodLayer";
import FloodHazardLayer from "../components/map/flood/FloodHazardLayer";
import FloodForecastPanel from "../components/map/flood/FloodForecastPanel";
import FloodAlertsLayer from "../components/map/flood/FloodAlertsLayer";

// typhoon
import TyphoonLayer, {
  TyphoonPanel,
} from "../components/map/typhoon/TyphoonLayer";

//landslide
import LandslideForecastPanel from "../components/map/landslide/LandslideForecastPanel";
import LandslideAlertsLayer from "../components/map/landslide/LandslideAlertsLayer";
import { LandslideHazardLayer } from "../components/map/landslide/LandslideLayer";

//earthquake
import EarthquakeLayer from "../components/map/earthquake/EarthquakeLayer";
import EarthquakePanel from "../components/map/earthquake/EarthquakePanel";

//reports
import ReportsLayer from "../components/map/reports/ReportsLayer";
import ReportFilter from "../components/map/ui/ReportFilter";

// evacuation
import EvacuationCentersLayer from "../components/map/evacuation/EvacuationCentersLayer";

// AI predictions
import AiPredictionLayer from "../components/map/predictions/AiPredictionLayer";

// ui
import HazardLegend from "../components/map/ui/HazardLegend";
import BasemapPicker from "../components/map/ui/BasemapPicker";
import OfflineBanner from "../components/map/ui/OfflineBanner";

const CITY_CENTER = [14.5882, 121.1763];
const CITY_NAME = "Antipolo City, Rizal";
const CITY_ZOOM = 13;

const STACK_TOP = 90;
const STACK_STEP = 40;

function MapReadyHandler({ onReady }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const t = setTimeout(onReady, 800);
    return () => clearTimeout(t);
  }, [map, onReady]);
  return null;
}

function FlyToUser({ trigger, userPos }) {
  const map = useMap();
  const prevTrigger = useRef(0);

  useEffect(() => {
    if (trigger === prevTrigger.current) return;
    prevTrigger.current = trigger;

    if (userPos) {
      map.flyTo(userPos, 17, { duration: 1.2 });
      map.invalidateSize();
      const timer = setTimeout(() => map.invalidateSize(), 1300);
      return () => clearTimeout(timer);
    }
  }, [trigger, userPos, map]);

  return null;
}

function FlyToTarget({ target }) {
  const map = useMap();
  const prevTarget = useRef(null);

  useEffect(() => {
    if (!target || target === prevTarget.current) return;
    prevTarget.current = target;
    map.flyTo([target.lat, target.lon], target.zoom ?? 8, { duration: 1.4 });
  }, [target, map]);

  return null;
}

function InvalidateSizeOnChange({ trigger }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(t);
  }, [trigger, map]);
  return null;
}

const INITIAL_LAYERS = {
  flood: true,
  earthquake: true,
  typhoon: false,
  fire: false,
  landslide: false,
  reports: true,
  evacuation: false,
  aiPredictions: false,
};

function buildAttribution(layers) {
  const sources = new Set();
  if (layers.flood) {
    sources.add("Open-Meteo");
    sources.add("Phil-LiDAR");
  }
  if (layers.typhoon) {
    sources.add("PAGASA");
    sources.add("GDACS");
  }
  if (layers.landslide) {
    sources.add("Open-Meteo");
    sources.add("MGB");
  }
  if (layers.earthquake) sources.add("USGS");
  if (layers.reports) sources.add("Community Reports");
  if (layers.aiPredictions) sources.add("AI Prediction Model");
  return Array.from(sources).join(" · ");
}

export default function HazardMapPage() {
  const [layers, setLayers] = useState(INITIAL_LAYERS);
  const [basemap, setBasemap] = useState("light");
  const [loading, setLoading] = useState(true);
  const [userPos, setUserPos] = useState(null);
  const [flyTrigger, setFlyTrigger] = useState(0);
  const [activePopup, setActivePopup] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [offlineInfo, setOfflineInfo] = useState({
    isOffline: false,
    cachedAt: null,
  });

  const [stormFlyTarget, setStormFlyTarget] = useState(null);

  const [reportFilters, setReportFilters] = useState({ types: ["all"] });
  const [filterOpen, setFilterOpen] = useState(false);

  const [earthquakeFilters, setEarthquakeFilters] = useState({
    timeRange: "week",
    minMagnitude: 2.5,
    region: "philippines",
    limit: 100,
  });
  const [earthquakeRefresh, setEarthquakeRefresh] = useState(0);

  const togglePopup = (name) =>
    setActivePopup((cur) => (cur === name ? null : name));

  const toggleLayer = (key) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleRecenter = () => {
    if (userPos) setFlyTrigger((n) => n + 1);
  };

  const handleOfflineChange = useCallback(({ isOffline, cachedAt }) => {
    setOfflineInfo((prev) => {
      if (prev.isOffline === isOffline && prev.cachedAt === cachedAt)
        return prev;
      return { isOffline, cachedAt };
    });
  }, []);

  // Close fullscreen on Escape key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const formatTime = (d) =>
    d.toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " · " +
    d.toLocaleTimeString("en-PH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const formatDateTime = (ts) => {
    if (!ts) return "unknown";
    const d = new Date(ts);
    return (
      d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) +
      " · " +
      d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
    );
  };

  const buttonStack = useMemo(() => {
    const stack = ["basemap", "recenter"];
    if (layers.flood) stack.push("forecast");
    if (layers.typhoon) stack.push("typhoon");
    if (layers.landslide) stack.push("landslide");
    if (layers.earthquake) stack.push("earthquake");
    return stack;
  }, [layers.flood, layers.typhoon, layers.landslide, layers.earthquake]);

  const btnStyle = useCallback(
    (key) => {
      const idx = buttonStack.indexOf(key);
      if (idx === -1) return { display: "none" };
      return { top: `${STACK_TOP + idx * STACK_STEP}px` };
    },
    [buttonStack],
  );

  const attribution = useMemo(() => buildAttribution(layers), [layers]);

  // ── shared map interior (used in both normal + fullscreen) ──────────────────
  const mapInterior = (
    <>
      {loading && (
        <div className="absolute inset-0 z-[2000] bg-white flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm font-medium">
            Loading hazard map…
          </p>
        </div>
      )}

      <BaseMap tileVariant={basemap} center={CITY_CENTER} zoom={CITY_ZOOM}>
        <FloodHazardLayer key="flood-haz" visible={layers.flood} />
        <FloodAlertsLayer visible={layers.flood} />
        <TyphoonLayer key="typhoon" visible={layers.typhoon} />
        <LandslideHazardLayer key="landslide-haz" visible={layers.landslide} />
        <LandslideAlertsLayer visible={layers.landslide} />
        <ReportsLayer
          visible={layers.reports || layers.flood || layers.landslide}
          showAlerts={layers.reports}
          filters={
            layers.reports
              ? reportFilters
              : {
                  types: [
                    layers.flood     && "flood",
                    layers.landslide && "landslide",
                  ].filter(Boolean),
                }
          }
        />
        <EarthquakeLayer
          visible={layers.earthquake}
          filters={earthquakeFilters}
          refreshTrigger={earthquakeRefresh}
        />
        <EvacuationCentersLayer visible={layers.evacuation} />
        <AiPredictionLayer visible={layers.aiPredictions} />
        <UserLocationMarker onLocated={setUserPos} />
        <FlyToUser trigger={flyTrigger} userPos={userPos} />
        <FlyToTarget target={stormFlyTarget} />
        <MapStatusBar />
        <MapReadyHandler onReady={() => setLoading(false)} />
        <InvalidateSizeOnChange trigger={isFullscreen} />
      </BaseMap>

      {offlineInfo.isOffline && (
        <OfflineBanner
          cachedAt={offlineInfo.cachedAt}
          onRefresh={() => window.location.reload()}
        />
      )}

      {/* Top-right badge + fullscreen button */}
      <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
        <div className="bg-white/90 backdrop-blur border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm pointer-events-none">
          <MapPin size={14} className="text-red-500 shrink-0" />
          <div>
            <p className="text-gray-800 text-xs font-bold leading-none">
              {CITY_NAME}
            </p>
            <p className="text-gray-400 text-[10px] mt-0.5 leading-none">
              {attribution}
            </p>
          </div>
        </div>
        {!isFullscreen && (
          <button
            onClick={() => setIsFullscreen(true)}
            title="Full-screen monitoring view"
            className="bg-white/90 backdrop-blur border border-gray-200 rounded-xl p-2 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <Maximize2 size={14} className="text-gray-500" />
          </button>
        )}
      </div>

      {/* LEFT BUTTON STACK */}
      <button
        onClick={() => togglePopup("basemap")}
        title="Change basemap"
        style={{ ...btnStyle("basemap"), left: 10, position: "absolute" }}
        className={`z-[1000] w-[30px] h-[30px] border flex items-center justify-center
                    shadow-sm hover:bg-gray-50 transition-colors
                    ${activePopup === "basemap" ? "bg-blue-50 border-blue-400" : "bg-white border-gray-300"}`}
      >
        <Map
          size={15}
          strokeWidth={1.8}
          className={
            activePopup === "basemap" ? "text-blue-500" : "text-gray-500"
          }
        />
      </button>

      <button
        onClick={handleRecenter}
        title="Go to my location"
        style={{ ...btnStyle("recenter"), left: 10, position: "absolute" }}
        className={`z-[1000] w-[30px] h-[30px] bg-white border border-gray-300
                    flex items-center justify-center shadow-sm hover:bg-gray-50 transition-colors
                    ${userPos ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}
      >
        <Crosshair
          size={16}
          strokeWidth={1.8}
          className={userPos ? "text-blue-500" : "text-gray-400"}
        />
      </button>

      {layers.flood && (
        <FloodForecastPanel
          visible={layers.flood}
          isOpen={activePopup === "forecast"}
          onToggle={() => togglePopup("forecast")}
          topStyle={btnStyle("forecast")}
          onOfflineChange={handleOfflineChange}
          onFlyTo={(lat, lon) => setStormFlyTarget({ lat, lon, zoom: 14, t: Date.now() })}
        />
      )}

      {layers.typhoon && (
        <TyphoonPanel
          visible={layers.typhoon}
          isOpen={activePopup === "typhoon"}
          onToggle={() => togglePopup("typhoon")}
          topStyle={btnStyle("typhoon")}
          onOfflineChange={handleOfflineChange}
          onFlyTo={(lat, lon) => setStormFlyTarget({ lat, lon, t: Date.now() })}
        />
      )}

      {layers.landslide && (
        <LandslideForecastPanel
          visible={layers.landslide}
          isOpen={activePopup === "landslide"}
          onToggle={() => togglePopup("landslide")}
          topStyle={btnStyle("landslide")}
          onOfflineChange={handleOfflineChange}
          onFlyTo={(lat, lon) => setStormFlyTarget({ lat, lon, zoom: 14, t: Date.now() })}
        />
      )}

      {layers.earthquake && (
        <EarthquakePanel
          visible={layers.earthquake}
          isOpen={activePopup === "earthquake"}
          onToggle={() => togglePopup("earthquake")}
          topStyle={btnStyle("earthquake")}
          onFilterChange={setEarthquakeFilters}
          onRefresh={() => setEarthquakeRefresh((prev) => prev + 1)}
          onOfflineChange={handleOfflineChange}
        />
      )}

      {activePopup === "basemap" && (
        <BasemapPicker
          active={basemap}
          onChange={(key) => {
            setBasemap(key);
            setActivePopup(null);
          }}
          onClose={() => setActivePopup(null)}
        />
      )}

      {layers.reports && (
        <ReportFilter
          isOpen={filterOpen}
          onToggle={() => setFilterOpen(!filterOpen)}
          onFilterChange={setReportFilters}
        />
      )}

      <LayerControlPanel layers={layers} onToggleLayer={toggleLayer} />
      <HazardLegend activeLayers={layers} />
    </>
  );

  // ── fullscreen overlay ──────────────────────────────────────────────────────
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col bg-gray-950">
        {/* Monitoring bar */}
        <div className="shrink-0 flex items-center justify-between px-5 py-2.5 bg-gray-900 border-b border-gray-700">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <MapPin size={14} className="text-red-400" />
            <span className="text-white text-sm font-bold tracking-wide">
              {CITY_NAME}
            </span>
            <span className="text-gray-500 text-xs hidden sm:inline">
              — CDRRMO Disaster Monitoring
            </span>
          </div>

          <div className="flex items-center gap-4">
            {offlineInfo.isOffline ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-amber-400 text-xs">
                  Cached · {formatDateTime(offlineInfo.cachedAt)}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-blue-300 text-sm font-mono tabular-nums tracking-wider">
                  {formatTime(now)}
                </span>
              </div>
            )}

            <button
              onClick={() => setIsFullscreen(false)}
              title="Exit full-screen (Esc)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-600 transition-colors"
            >
              <Minimize2 size={13} className="text-gray-400" />
              <span className="text-gray-400 text-xs">Exit</span>
            </button>
          </div>
        </div>

        {/* Map area */}
        <div className="flex-1 relative overflow-hidden">{mapInterior}</div>
      </div>
    );
  }

  // ── normal view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Hazard Map</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {CITY_NAME} — Disaster Preparedness Viewer
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          {offlineInfo.isOffline ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-sm text-amber-600">
                Last update:{" "}
                <span className="font-semibold">
                  {formatDateTime(offlineInfo.cachedAt)}
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm text-slate-600 tabular-nums">
                {formatTime(now)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Map wrapper */}
      <div className="relative flex-1 rounded-2xl overflow-hidden isolate border border-gray-200 shadow-lg min-h-[400px] sm:min-h-[550px]">
        {mapInterior}
      </div>
    </div>
  );
}
