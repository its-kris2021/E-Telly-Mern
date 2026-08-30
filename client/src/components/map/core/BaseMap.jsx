import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  ScaleControl,
} from "react-leaflet";

// Preconnecting these globally (e.g. from index.html) would make every page
// — including the login screen, which never touches a map — pay connection
// setup for origins it doesn't use. Injecting them only while a map is
// actually mounted keeps that cost off the critical path everywhere else.
const TILE_ORIGINS = [
  "https://a.tile.openstreetmap.org",
  "https://b.tile.openstreetmap.org",
  "https://c.tile.openstreetmap.org",
  "https://lipad-fmc.dream.upd.edu.ph",
  "https://earthquake.usgs.gov",
];

function useMapPreconnects() {
  useEffect(() => {
    const links = TILE_ORIGINS.map((origin) => {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "";
      document.head.appendChild(link);
      return link;
    });
    return () => links.forEach((link) => link.remove());
  }, []);
}

const TILES = {
  // CARTO's basemaps.cartocdn.com XYZ tiles now require a registered API key
  // for anonymous use — unauthenticated requests come back watermarked
  // "API KEY REQUIRED" instead of the actual map. Standard OSM tiles need no
  // key; "dark" reuses them with a CSS invert filter (see .dark-basemap-tiles
  // in index.css) since OSM has no free keyless dark style.
  light: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    className: "dark-basemap-tiles",
  },

  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://opentopomap.org/">OpenTopoMap</a>',
  },
};

const BaseMap = ({
  children,
  tileVariant = "light",
  center = [14.676, 121.0437], // Navotas / Metro Manila default
  zoom = 13,
}) => {
  const tile = TILES[tileVariant] ?? TILES.light;
  useMapPreconnects();

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={5}
      maxZoom={18}
      zoomControl={false}
      className="w-full h-full"
    >
      <TileLayer
        // keyed on variant: className isn't a prop react-leaflet hot-swaps on
        // an existing layer (only url/opacity/zIndex are), so switching
        // light -> dark needs a fresh TileLayer to pick up dark-basemap-tiles.
        key={tileVariant}
        url={tile.url}
        attribution={tile.attribution}
        className={tile.className}
        keepBuffer={2}
      />
      <ZoomControl position="topleft" />
      <ScaleControl position="bottomleft" imperial={false} />
      {children}
    </MapContainer>
  );
};

export default BaseMap;
