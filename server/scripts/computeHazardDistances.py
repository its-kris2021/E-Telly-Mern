"""
One-time script that produced LANDSLIDE_HAZARD_DISTANCE_KM and
FLOOD_HAZARD_DISTANCE_KM in server/config/barangays.js.

Not run automatically (no server code imports this) — the 49MB/13MB source
shapefiles aren't checked into the repo, so this is kept purely for
reproducibility/defense documentation: proof the susceptibility feature is
grounded in third-party geohazard mapping, not citizen reports or a
hand-picked barangay list.

Inputs (place alongside this script's working directory, or edit BASE below):
  Rizal_Landslide/Rizal_LandslideHazards.shp  (field "LH": 1=Low,2=Moderate,3=High)
  Rizal_flood_25year/Rizal_Flood_25year.shp   (field "Var": 1=Low,2=Moderate,3=High, 25-yr return period)
  Both GCS_WGS_1984 (plain lat/lng degrees).

Method: for each of the 17 Antipolo barangay centroids (server/config/barangays.js
BARANGAY_COORDS), compute the minimum distance in km from the centroid to the
nearest edge of any "High" (class 3) polygon in each shapefile — a point-to-
segment distance over every boundary edge, using an equirectangular
approximation (flat-earth, scaled by km-per-degree at Antipolo's latitude)
since the area of interest spans only tens of km. 0 km means the centroid
falls inside a High-hazard polygon.

Why distance instead of simple point-in-polygon containment: tried
containment first (does the centroid fall inside the High/Moderate/Low
polygon?) and most of the 17 barangay centroids landed in gaps between the
mapped hazard polygons (which only delineate specific susceptible patches, not
the full province) — including barangays MGB's own high-susceptibility list
names (calawis, dalig, sanjose, mambugan). No barangay boundary polygons exist
in this codebase to do a proper area-overlap join instead, so distance-to-
nearest-hazard-zone was used as the next-best continuous signal.

Requires: pip install pyshp numpy
"""
import shapefile
import numpy as np

BASE = "."  # directory containing Rizal_Landslide/ and Rizal_flood_25year/

BARANGAY_COORDS = {
    "bagongnayon":  (14.6261, 121.1687),
    "beverlyhills": (14.5843, 121.1582),
    "calawis":      (14.6731, 121.2423),
    "cupang":       (14.6360, 121.1239),
    "dalig":        (14.5763, 121.1820),
    "delapaz":      (14.5901, 121.1703),
    "inarawan":     (14.6248, 121.1950),
    "mambugan":     (14.6206, 121.1416),
    "mayamot":      (14.6247, 121.1233),
    "muntindilaw":  (14.5989, 121.1301),
    "private":      (14.5973, 121.1836),
    "sanisidro":    (14.5916, 121.1838),
    "sanjose":      (14.6236, 121.2598),
    "sanjuan":      (14.6278, 121.1770),
    "sanluis":      (14.6043, 121.1981),
    "sanroque":     (14.5832, 121.1719),
    "santacruz":    (14.6157, 121.1694),
}

LAT0 = 14.6
KM_PER_DEG_LAT = 111.32
KM_PER_DEG_LON = 111.32 * np.cos(np.radians(LAT0))


def load_class_edges(path, field, class_value):
    """All boundary edges (x1,y1,x2,y2 in degrees) for records matching class_value."""
    sf = shapefile.Reader(path)
    edges = []
    for sr in sf.shapeRecords():
        if sr.record[field] != class_value:
            continue
        pts = np.asarray(sr.shape.points)
        parts = list(sr.shape.parts) + [len(pts)]
        for j in range(len(parts) - 1):
            ring = pts[parts[j]:parts[j + 1]]
            if len(ring) < 2:
                continue
            a, b = ring, np.roll(ring, -1, axis=0)
            edges.append(np.hstack([a, b]))
    return np.vstack(edges) if edges else np.zeros((0, 4))


def min_distance_km(lng, lat, edges):
    if edges.shape[0] == 0:
        return None
    x1, y1 = edges[:, 0] * KM_PER_DEG_LON, edges[:, 1] * KM_PER_DEG_LAT
    x2, y2 = edges[:, 2] * KM_PER_DEG_LON, edges[:, 3] * KM_PER_DEG_LAT
    px, py = lng * KM_PER_DEG_LON, lat * KM_PER_DEG_LAT
    dx, dy = x2 - x1, y2 - y1
    len2 = np.where(dx * dx + dy * dy == 0, 1, dx * dx + dy * dy)
    t = np.clip(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1)
    projx, projy = x1 + t * dx, y1 + t * dy
    return float(np.sqrt((px - projx) ** 2 + (py - projy) ** 2).min())


def main():
    landslide_edges = load_class_edges(f"{BASE}/Rizal_Landslide/Rizal_LandslideHazards.shp", "LH", 3.0)
    flood_edges = load_class_edges(f"{BASE}/Rizal_flood_25year/Rizal_Flood_25year.shp", "Var", 3.0)

    print("export const LANDSLIDE_HAZARD_DISTANCE_KM = {")
    for name, (lat, lng) in BARANGAY_COORDS.items():
        d = min_distance_km(lng, lat, landslide_edges)
        print(f"  {name}: {d:.3f},")
    print("};\n")

    print("export const FLOOD_HAZARD_DISTANCE_KM = {")
    for name, (lat, lng) in BARANGAY_COORDS.items():
        d = min_distance_km(lng, lat, flood_edges)
        print(f"  {name}: {d:.3f},")
    print("};")


if __name__ == "__main__":
    main()
