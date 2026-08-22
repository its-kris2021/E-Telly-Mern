import { WMSTileLayer } from "react-leaflet";

const LIPAD_WMS_URL = "https://lipad-fmc.dream.upd.edu.ph/geoserver/wms";

const FloodHazardLayer = ({ visible }) => {
  if (!visible) return null;

  return (
    <WMSTileLayer
      url={LIPAD_WMS_URL}
      // Antipolo City, Rizal — 25-year return period
      // Layer code: ph045802000 = Antipolo City PSA code
      layers="geonode:ph045802000_fh25yr_10m"
      // png8 (8-bit indexed) instead of full 24/32-bit png: this layer is a
      // flat-color hazard overlay, so palette reduction is lossless-looking
      // but cuts each tile ~60% (verified against this GeoServer instance).
      format="image/png8"
      transparent={true}
      opacity={0.75}
      version="1.1.1"
      attribution='&copy; <a href="https://lipad-fmc.dream.upd.edu.ph">Phil-LiDAR 1 / UP DREAM</a>'
    />
  );
};

export default FloodHazardLayer;
