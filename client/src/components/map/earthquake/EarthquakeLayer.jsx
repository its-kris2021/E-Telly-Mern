import { useEffect, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

// Create custom earthquake marker based on magnitude
const createEarthquakeIcon = (magnitude) => {
  // Color coding based on magnitude
  let color;
  let size;

  if (magnitude >= 7) {
    color = "#b91c1c"; // Dark red - Major
    size = 36;
  } else if (magnitude >= 6) {
    color = "#ef4444"; // Red - Strong
    size = 32;
  } else if (magnitude >= 5) {
    color = "#f97316"; // Orange - Moderate
    size = 28;
  } else if (magnitude >= 4) {
    color = "#eab308"; // Yellow - Light
    size = 24;
  } else if (magnitude >= 3) {
    color = "#06b6d4"; // Cyan - Minor
    size = 20;
  } else {
    color = "#6b7280"; // Gray - Micro
    size = 16;
  }

  return L.divIcon({
    className: "earthquake-marker",
    html: `
      <div style="
        background: ${color};
        border: 3px solid white;
        border-radius: 50%;
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
        color: white;
        font-weight: bold;
        font-size: ${size > 24 ? "12px" : "10px"};
      ">
        ${magnitude.toFixed(1)}
      </div>
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        width: ${size * 2}px;
        height: ${size * 2}px;
        border: 2px solid ${color};
        border-radius: 50%;
        transform: translate(-50%, -50%);
        opacity: 0.3;
        animation: earthquake-pulse 2s infinite;
      "></div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

export default function EarthquakeLayer({ visible, filters = {}, refreshTrigger }) {
  const map = useMap();
  const [earthquakes, setEarthquakes] = useState([]);
  const [markersLayer, setMarkersLayer] = useState(null);

  // USGS API endpoint for past 30 days, magnitude 2.5+
  const USGS_API_URL =
    "https://earthquake.usgs.gov/fdsnws/event/1/query";

  // Fetch earthquake data from USGS
  const fetchEarthquakeData = async () => {
    try {

      // filters.starttime is the ISO date computed by EarthquakePanel when the
      // user picks a time range. filters.timeRange ("day"/"week"/"month") is a
      // UI label only — passing it directly to USGS causes a 400 Bad Request.
      const starttime = filters.starttime || getDefaultStartTime();
      const endtime = new Date().toISOString();
      const minMagnitude = parseFloat(filters.minMagnitude) || 2.5;
      const limit = parseInt(filters.limit, 10) || 100;

      // Guard: abort if either date is not a valid ISO 8601 string.
      if (isNaN(Date.parse(starttime)) || isNaN(Date.parse(endtime))) {
        console.error("[EarthquakeLayer] Invalid date params — fetch aborted:", {
          starttime,
          endtime,
        });
        return;
      }

      const params = new URLSearchParams({
        format: "geojson",
        starttime,
        endtime,
        minmagnitude: minMagnitude,
        limit,
        orderby: "magnitude",
      });

      if (filters.maxMagnitude != null && !isNaN(parseFloat(filters.maxMagnitude))) {
        params.set("maxmagnitude", parseFloat(filters.maxMagnitude));
      }

      if (filters.region === "philippines") {
        params.set("minlatitude", "4.5");
        params.set("maxlatitude", "21.5");
        params.set("minlongitude", "116.0");
        params.set("maxlongitude", "127.0");
      }

      const url = `${USGS_API_URL}?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[EarthquakeLayer] USGS ${response.status}:`, errorText);
        throw new Error(`USGS API ${response.status}: ${errorText.slice(0, 150)}`);
      }
      const data = await response.json();

      setEarthquakes(data.features || []);
    } catch (error) {
      console.error("[EarthquakeLayer] USGS fetch error:", error);
    }
  };

  // Get default start time (past 30 days)
  const getDefaultStartTime = () => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString();
  };

  // Initialize markers layer
  useEffect(() => {
    if (!map) return;

    const layer = L.layerGroup().addTo(map);
    setMarkersLayer(layer);

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  // Handle visibility, filter, and manual refresh triggers
  useEffect(() => {
    if (visible) {
      fetchEarthquakeData();
    }
  }, [visible, filters, refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update markers when earthquake data changes
  useEffect(() => {
    if (!markersLayer) return;

    if (!visible) {
      markersLayer.clearLayers();
      return;
    }

    if (!earthquakes.length) return;

    // Clear existing markers
    markersLayer.clearLayers();

    // Add markers for each earthquake
    earthquakes.forEach((eq) => {
      const props = eq.properties;
      const geometry = eq.geometry;

      if (!geometry || !geometry.coordinates) return;

      const [longitude, latitude, depth] = geometry.coordinates;

      const marker = L.marker([latitude, longitude], {
        icon: createEarthquakeIcon(props.mag),
      });

      const popupContent = createPopupContent(
        props,
        latitude,
        longitude,
        depth,
      );
      marker.bindPopup(popupContent, {
        maxWidth: 300,
        minWidth: 250,
      });

      marker.addTo(markersLayer);
    });
  }, [earthquakes, markersLayer, visible]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      fetchEarthquakeData();
    }, 300000); // 5 minutes

    return () => clearInterval(interval);
  }, [visible, filters]);

  return null;
}

// Create popup content for earthquake
function createPopupContent(props, lat, lng, depth) {
  const time = new Date(props.time).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Determine magnitude color
  const getMagColor = (mag) => {
    if (mag >= 7) return "#b91c1c";
    if (mag >= 6) return "#ef4444";
    if (mag >= 5) return "#f97316";
    if (mag >= 4) return "#eab308";
    if (mag >= 3) return "#06b6d4";
    return "#6b7280";
  };

  const magColor = getMagColor(props.mag);

  // Determine tsunami warning
  const tsunamiWarning =
    props.tsunami === 1
      ? '<div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 8px 12px; border-radius: 4px; margin-top: 12px;"><p style="margin: 0; font-size: 13px; color: #991b1b; font-weight: 600;">TSUNAMI WARNING ISSUED</p></div>'
      : "";

  // Alert level indicator
  const alertLevel = props.alert;
  const alertBadge = alertLevel
    ? {
        green:
          '<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">GREEN</span>',
        yellow:
          '<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">YELLOW</span>',
        orange:
          '<span style="background: #ffedd5; color: #9a3412; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">ORANGE</span>',
        red: '<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">RED</span>',
      }[alertLevel]
    : "";

  return `
    <div class="earthquake-popup">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <h3 style="font-weight: 700; font-size: 16px; margin: 0; color: #1f2937;">
          ${props.place || "Unknown Location"}
        </h3>
        ${alertBadge}
      </div>
      
      <div style="display: flex; gap: 12px; margin-bottom: 12px;">
        <div style="text-align: center;">
          <div style="
            background: ${magColor};
            color: white;
            font-weight: bold;
            font-size: 28px;
            padding: 8px 16px;
            border-radius: 12px;
            min-width: 80px;
          ">
            ${props.mag.toFixed(1)}
          </div>
          <p style="font-size: 11px; color: #6b7280; margin-top: 4px;">Magnitude</p>
        </div>
        <div style="flex: 1;">
          <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px 0;">Depth</p>
          <p style="font-size: 16px; font-weight: 600; color: #1f2937; margin: 0;">
            ${depth.toFixed(1)} km
          </p>
        </div>
      </div>
      
      <div style="background: #f9fafb; padding: 8px 12px; border-radius: 6px; margin: 12px 0; font-size: 12px;">
        <div style="display: flex; gap: 8px; margin-bottom: 4px;">
          <span style="color: #6b7280; min-width: 70px;">Time:</span>
          <span style="color: #1f2937;">${time}</span>
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 4px;">
          <span style="color: #6b7280; min-width: 70px;">Coordinates:</span>
          <span style="color: #1f2937;">${lat.toFixed(3)}°, ${lng.toFixed(3)}°</span>
        </div>
        ${
          props.felt
            ? `
        <div style="display: flex; gap: 8px; margin-bottom: 4px;">
          <span style="color: #6b7280; min-width: 70px;">Felt:</span>
          <span style="color: #1f2937;">${props.felt} reports</span>
        </div>
        `
            : ""
        }
        ${
          props.sig
            ? `
        <div style="display: flex; gap: 8px;">
          <span style="color: #6b7280; min-width: 70px;">Significance:</span>
          <span style="color: #1f2937;">${props.sig}</span>
        </div>
        `
            : ""
        }
      </div>
      
      ${tsunamiWarning}
      
      <div style="margin-top: 12px; font-size: 10px; color: #9ca3af; text-align: right;">
        Source: USGS Earthquake Hazards Program
      </div>
    </div>
  `;
}
