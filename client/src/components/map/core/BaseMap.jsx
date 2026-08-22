import {
  MapContainer,
  TileLayer,
  ZoomControl,
  ScaleControl,
} from "react-leaflet";

const TILES = {
  light: {
    // No {r} (retina) token: Leaflet's getTileUrl() swaps it for "@2x" on any
    // high-DPI screen regardless of detectRetina, but detectRetina isn't set
    // here — so the tile grid stays standard-resolution and we'd just be
    // downloading a 512x512 image to fill a ~256px slot for no visual gain.
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
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

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={5}
      maxZoom={18}
      zoomControl={false}
      className="w-full h-full"
    >
      <TileLayer url={tile.url} attribution={tile.attribution} keepBuffer={2} />
      <ZoomControl position="topleft" />
      <ScaleControl position="bottomleft" imperial={false} />
      {children}
    </MapContainer>
  );
};

export default BaseMap;
