import { WMSTileLayer } from "react-leaflet";

const PHIL_GEOPORTAL_WMS_URL =
  "https://geoserver.geoportal.gov.ph/geoserver/geoportal/wms";

// WMS tile overlay from Philippine Geoportal (MGB landslide susceptibility data)
export const LandslideHazardLayer = ({ visible }) => {
  if (!visible) return null;

  return (
    <WMSTileLayer
      url={PHIL_GEOPORTAL_WMS_URL}
      layers="landslide10ksusceptibility"
      // png8 (8-bit indexed) instead of full 24/32-bit png: this layer is a
      // flat-color hazard overlay, so palette reduction is lossless-looking
      // but cuts each tile ~75% (verified against this GeoServer instance).
      format="image/png8"
      transparent={true}
      opacity={0.4}
      version="1.1.1"
      attribution='&copy; <a href="https://geoportal.gov.ph">Philippine Geoportal / MGB</a>'
    />
  );
};
