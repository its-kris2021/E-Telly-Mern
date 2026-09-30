import { useState, useEffect, useRef } from "react";
import { Search, X, MapPin, Navigation, Loader2 } from "lucide-react";
import { loadLeaflet } from "./leafletLoader";
import { geocode, reverseGeocode } from "./nominatim";

export default function LocationPicker({
  location,
  onLocationChange,
  onCoordinatesChange,
  required = false,
  label = "Affected Location",
}) {
  const [query,       setQuery]       = useState(location ?? "");
  const [suggestions, setSuggestions] = useState([]);
  const [searching,   setSearching]   = useState(false);
  const [confirmed,   setConfirmed]   = useState(location ?? "");
  const [showMap,     setShowMap]     = useState(false);
  const [geolocating, setGeolocating] = useState(false);

  const debounceRef         = useRef(null);
  const mapRef              = useRef(null);
  const mapInstanceRef      = useRef(null);
  const markerRef           = useRef(null);
  const pendingRef          = useRef(null);
  const userDotRef          = useRef(null);
  const pendingUserDotRef   = useRef(null);

  // ── Search ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q || q.length < 3 || q === confirmed) { setSuggestions([]); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await geocode(q);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 420);
  }, [query, confirmed]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const commitLocation = (addr, lat, lon) => {
    setQuery(addr);
    setConfirmed(addr);
    setSuggestions([]);
    onLocationChange(addr);
    onCoordinatesChange?.(lat, lon);
  };

  const pickSuggestion = (item) => {
    const addr = item.display_name;
    const lat  = parseFloat(item.lat);
    const lon  = parseFloat(item.lon);
    commitLocation(addr, lat, lon);

    if (mapInstanceRef.current) {
      dropPin(mapInstanceRef.current, lat, lon, addr);
      mapInstanceRef.current.flyTo([lat, lon], 17, { duration: 0.7 });
    } else {
      pendingRef.current = { lat, lon, addr };
      setShowMap(true);
    }
  };

  // ── Drop / move marker ──────────────────────────────────────────────────────
  const dropPin = (map, lat, lon, label) => {
    const L = window.L;
    const pinHtml = `
      <div class="lp-pin">
        <div class="lp-pin-head"></div>
        <div class="lp-pin-dot"></div>
      </div>`;

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lon]);
    } else {
      const icon = L.divIcon({
        className: "",
        html: pinHtml,
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -44],
      });
      markerRef.current = L.marker([lat, lon], { icon, draggable: true }).addTo(map);

      markerRef.current.on("dragend", async (e) => {
        const pos = e.target.getLatLng();
        const addr = await reverseGeocode(pos.lat, pos.lng);
        commitLocation(addr, pos.lat, pos.lng);
        markerRef.current?.setPopupContent(
          `<div class="lp-popup-text">${addr}</div>`,
        );
      });
    }

    if (label) {
      markerRef.current
        .bindPopup(`<div class="lp-popup-text">${label}</div>`, { closeButton: false })
        .openPopup();
    }
  };

  // ── Blue "you are here" dot ─────────────────────────────────────────────────
  const addUserDot = (map, lat, lon) => {
    const L = window.L;
    const dotHtml = `
      <div class="lp-user-dot">
        <div class="lp-user-dot-ring"></div>
        <div class="lp-user-dot-center"></div>
      </div>`;
    if (userDotRef.current) {
      userDotRef.current.setLatLng([lat, lon]);
    } else {
      const icon = L.divIcon({ className: "", html: dotHtml, iconSize: [20, 20], iconAnchor: [10, 10] });
      userDotRef.current = L.marker([lat, lon], { icon, interactive: false, zIndexOffset: -100 }).addTo(map);
    }
  };

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showMap || !mapRef.current || mapInstanceRef.current) return;
    let cancelled = false;

    loadLeaflet().then((L) => {
      if (cancelled || !mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true }).setView([14.5882, 121.1763], 14);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const bounds = L.latLngBounds([14.52, 121.08], [14.7, 121.26]);
      map.setMaxBounds(bounds.pad(0.05));

      map.on("click", async (e) => {
        const { lat, lng } = e.latlng;
        dropPin(map, lat, lng, null);
        map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.4 });
        const addr = await reverseGeocode(lat, lng);
        commitLocation(addr, lat, lng);
        markerRef.current
          ?.bindPopup(`<div class="lp-popup-text">${addr}</div>`, { closeButton: false })
          .openPopup();
      });

      if (pendingUserDotRef.current) {
        const { lat, lon } = pendingUserDotRef.current;
        pendingUserDotRef.current = null;
        addUserDot(map, lat, lon);
      }

      if (pendingRef.current) {
        const { lat, lon, addr } = pendingRef.current;
        pendingRef.current = null;
        dropPin(map, lat, lon, addr);
        map.flyTo([lat, lon], 17, { duration: 0.7 });
      }
    });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
        userDotRef.current = null;
      }
    };
  }, [showMap]);

  // ── "Use my location" ───────────────────────────────────────────────────────
  const handleGeolocate = () => {
    if (!navigator.geolocation || geolocating) return;
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const addr = await reverseGeocode(latitude, longitude);
        commitLocation(addr, latitude, longitude);
        setGeolocating(false);

        if (mapInstanceRef.current) {
          addUserDot(mapInstanceRef.current, latitude, longitude);
          dropPin(mapInstanceRef.current, latitude, longitude, addr);
          mapInstanceRef.current.flyTo([latitude, longitude], 17, { duration: 0.7 });
        } else {
          pendingUserDotRef.current = { lat: latitude, lon: longitude };
          pendingRef.current = { lat: latitude, lon: longitude, addr };
          setShowMap(true);
        }
      },
      () => setGeolocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const clear = () => {
    setQuery("");
    setConfirmed("");
    setSuggestions([]);
    onLocationChange("");
    onCoordinatesChange?.(null, null);
    if (markerRef.current && mapInstanceRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (userDotRef.current && mapInstanceRef.current) {
      userDotRef.current.remove();
      userDotRef.current = null;
    }
    pendingUserDotRef.current = null;
  };

  const shortLabel = (displayName) => {
    const parts = displayName.split(", ");
    return { primary: parts[0], secondary: parts.slice(1, 4).join(", ") };
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-gray-500 block">
        {label} {required && <span className="text-red-500">*</span>}
      </label>

      {/* Search input with inline GPS button */}
      <div className="relative">
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) { setConfirmed(""); onLocationChange(""); onCoordinatesChange?.(null, null); }
          }}
          placeholder="Search street, landmark, or place in Antipolo…"
          autoComplete="off"
          className={`w-full text-sm border border-gray-200 rounded-lg pl-8 py-2.5
                      text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400
                      focus:border-transparent transition-all
                      ${query ? "pr-16" : "pr-9"}`}
        />

        {/* Clear — shown when there is text, sits left of GPS */}
        {query && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
          >
            <X size={13} />
          </button>
        )}

        {/* GPS / Use my location — always rightmost */}
        <button
          type="button"
          onClick={handleGeolocate}
          disabled={geolocating}
          title="Use my current location"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-50"
        >
          {geolocating
            ? <Loader2 size={13} className="animate-spin" />
            : <Navigation size={13} />}
        </button>

        {/* Spinner (search) */}
        {searching && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl px-3 py-3 flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-xs text-gray-400">Searching Antipolo…</span>
          </div>
        )}

        {/* Suggestions */}
        {!searching && suggestions.length > 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
            {suggestions.map((item, i) => {
              const { primary, secondary } = shortLabel(item.display_name);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickSuggestion(item)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-start gap-2">
                    <MapPin size={11} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-gray-800">{primary}</p>
                      <p className="text-[11px] text-gray-400">{secondary}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* No results */}
        {!searching && query.length >= 3 && query !== confirmed && suggestions.length === 0 && (
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-xl px-3 py-3">
            <p className="text-xs text-gray-400">No results in Antipolo. Try a different name.</p>
          </div>
        )}
      </div>

      {/* Confirmed location pill */}
      {confirmed && (
        <div className="flex items-start gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
          <Navigation size={11} className="text-green-600 flex-shrink-0 mt-0.5" />
          <span className="text-[11px] text-green-700 leading-relaxed">{confirmed}</span>
        </div>
      )}

      {/* Map toggle */}
      <button
        type="button"
        onClick={() => setShowMap((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
      >
        <MapPin size={12} />
        {showMap ? "Hide map" : "Or pin directly on map"}
      </button>

      {/* Leaflet map */}
      {showMap && (
        <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
          <div className="bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500 border-b border-gray-100 flex items-center gap-1.5">
            <MapPin size={10} className="text-red-400 flex-shrink-0" />
            Tap anywhere to drop a pin · Drag pin to fine-tune · Limited to Antipolo City
          </div>
          <div ref={mapRef} style={{ height: 240 }} />
        </div>
      )}
    </div>
  );
}
