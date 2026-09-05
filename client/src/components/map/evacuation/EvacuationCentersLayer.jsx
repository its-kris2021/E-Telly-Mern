import { useEffect, useState, useCallback } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import { connectSocket } from "../../../utils/socket";

const TOKEN = () => localStorage.getItem("token");

async function apiFetch(path) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${TOKEN()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const COORDS = {
  // ── Bagong Nayon (Cogeo area) ─────────────────────────────────────────────
  "bagongnayon|Barangay Hall Gym Covered Court":                   [14.626080463429222, 121.16871690148847],
  "bagongnayon|Barangay Hall Health Center":                       [14.626031269517606, 121.16872812183026],
  "bagongnayon|Barangay Hall School Day Care Center":              [14.626087624405825, 121.16887413021486],
  // "bagongnayon|Barangay Hall Operations Center":                [14.6276, 121.2054],  // NA
  "bagongnayon|Cogeo 1 Daycare center":                            [14.629750801995282, 121.16331878286434],
  // "bagongnayon|Cogeo 2 Daycare center":                         [14.6298, 121.2068],  // NA
  // "bagongnayon|ALS Center":                                     [14.6285, 121.2055],  // NA
  "bagongnayon|Livelihood Center":                                 [14.626109935902823, 121.16872579313947],
  "bagongnayon|Conference Covered Court":                          [14.630069345738608, 121.16359796898647],
  // "bagongnayon|La Colina Covered Court":                        [14.6210, 121.1980],  // NA
  // ── Beverly Hills ─────────────────────────────────────────────────────────
  "beverlyhills|Barangay Hall 2-storey Bldg.":                     [14.584244406427, 121.15782963101199],
  "beverlyhills|Barangay Covered Court":                           [14.58439566569219, 121.15855847789283],
  // ── Calawis ───────────────────────────────────────────────────────────────
  "calawis|Barangay Hall":                                         [14.670879986725202, 121.24209717965446],
  "calawis|Calawis Covered Court Purok 6":                         [14.684555648253808, 121.24376143708587],
  "calawis|Calawis Elementary School":                             [14.673404678543303, 121.24229561839971],
  "calawis|Calawis National High School":                          [14.685114989824527, 121.24340322552595],
  "calawis|Calawis Day Care Center":                               [14.671506868865407, 121.24171849010925],
  // ── Cupang ────────────────────────────────────────────────────────────────
  "cupang|Barangay Hall Covered Court":                            [14.636011615678756, 121.12392432145741],
  "cupang|Area Dela Paz Court":                                    [14.631422942291007, 121.13829389640073],
  "cupang|Villa Grande Covered Court":                             [14.650098085700224, 121.13494455246101],
  "cupang|Panorama Hills Covered Court":                           [14.638668166183225, 121.13461805722737],
  "cupang|Taguete Covered Court":                                  [14.631941203306484, 121.13625475136024],
  "cupang|Sierra Vista Covered Court":                             [14.633882781387186, 121.12686838518528],
  "cupang|Manseta Covered Court":                                  [14.640685171055502, 121.13527865222312],
  // ── Dalig ─────────────────────────────────────────────────────────────────
  "dalig|Barangay Hall Multipurpose Covered Court":                [14.572675564139795, 121.18655860513668],
  "dalig|Isaias Tapales Elementary School":                        [14.580167937449684, 121.17846380124182],
  "dalig|Kamatisan Covered Court":                                 [14.577078993805666, 121.17762280780528],
  "dalig|Dalig National High School":                              [14.575235498344712, 121.19293404477926],
  // ── Dela Paz ──────────────────────────────────────────────────────────────
  // "delapaz|Barangay Hall Covered Court":                        [14.6350, 121.1520],  // NA
  "delapaz|Barangay Hall Main Hall":                               [14.588837091950742, 121.17419327562496],
  "delapaz|Barangay Hall Annex":                                   [14.619188581325641, 121.18012783156549],
  "delapaz|Barangay Hall Annex Covered Court Purok Imelda":        [14.619485456649823, 121.17989274408907],
  "delapaz|Dela Paz National High School":                         [14.590530891343356, 121.17031075407138],
  // "delapaz|Phase 4B Covered Court":                             [14.6340, 121.1535],  // NA
  "delapaz|Sitio Ivory Covered Court":                             [14.61530734321826, 121.17221725516985],
  // "delapaz|Sitio Broadway Multipurpose Hall":                   [14.6380, 121.1545],  // NA — permanently closed
  "delapaz|Palmera V Covered Court":                               [14.591931457195026, 121.15274151198956],
  "delapaz|Green Forest Multipurpose Hall":                        [14.617985783513582, 121.17518328649908],
  // "delapaz|Green Forest Daycare Center":                        [14.6362, 121.1558],  // NA
  // ── Inarawan ──────────────────────────────────────────────────────────────
  "inarawan|Inarawan Livelihood Center (Barangay)":                [14.624821158684705, 121.18046215307378],
  "inarawan|Maagay 3 Day Care Center":                             [14.623805986227822, 121.1899167540716],
  // "inarawan|Central 1 Central Day Care Center":                 [14.5885, 121.2075],  // NA
  // "inarawan|KB 4 Open Area Basketball Court":                   [14.5892, 121.2082],  // NA
  "inarawan|Inuman Elementary School":                             [14.624910672743516, 121.21733266756495],
  // "inarawan|Saint Anthony Covered Court":                       [14.5888, 121.2078],  // NA
  // ── Mambugan ──────────────────────────────────────────────────────────────
  "mambugan|Mambugan Elementary School and Covered Court":         [14.618483880397369, 121.13573485171437],
  // "mambugan|Josefina Elementary School and Covered Court":      [14.6500, 121.2060],  // NA
  "mambugan|Siruna National High School and Covered Court":        [14.623307096083186, 121.14212288724956],
  "mambugan|Mambugan Barangay Hall":                               [14.620590337149023, 121.141633909276],
  "mambugan|La Colina Covered Court":                              [14.611047451086046, 121.13644952261694],
  // ── Mayamot ───────────────────────────────────────────────────────────────
  "mayamot|Kingsville Evacuation Center (City Manage)":            [14.624668116713282, 121.12326876756502],
  "mayamot|Kingsville Evacuation Center( City Manage)":            [14.6005, 121.1885],
  "mayamot|Mayamot Elementary School Covered Court":               [14.630235215057867, 121.12078721478203],
  // "mayamot|Mayamot Daycare Center":                             [14.5968, 121.1840],  // NA
  // ── Muntindilaw ───────────────────────────────────────────────────────────
  // "muntindilaw|Puno Multipurpose Hall – Rescue Bldg.":          [14.6232, 121.1640],  // NA
  // "muntindilaw|Puno Multipurpose Hall – Rescue Bldg. Compound": [14.6232, 121.1640],  // NA
  "muntindilaw|Muntindilaw National High School":                  [14.598892299749012, 121.1301411058664],
  "muntindilaw|Barangay Covered Court":                            [14.598388909557519, 121.13064521221689],
  // "muntindilaw|Area 4B Basketball Open Court":                  [14.6288, 121.1708],  // NA
  "muntindilaw|Skylark St. Vista Verde Bldg.":                     [14.599849871072996, 121.12710159596216],
  "muntindilaw|Skylark St. Visit Verde Bldg.":                     [14.599351160807533, 121.12645693758138],
  "muntindilaw|Saint Martin De Porres":                            [14.599604146066408, 121.13108183175862],
  "muntindilaw|Sitio Mahayahay Open Court BC":                     [14.602175569836161, 121.12824760770297],
  // "muntindilaw|Muntindilaw Daycare Center":                     [14.6230, 121.1643],  // NA
  "muntindilaw|Muntindilaw Elementary School":                     [14.597602829812942, 121.12625230539115],
  "muntindilaw|Muntindilaw Elem. School":                          [14.597602829812942, 121.12625230539115],
  // "muntindilaw|KB 4 Open Area Basketball Court":                [14.6283, 121.1703],  // NA
  "muntindilaw|Village East Clubhouse Basketball Court":           [14.601092575253976, 121.11462557667842],
  "muntindilaw|Vista Verde Executive Basketball Court":            [14.604062008363243, 121.11487412939127],
  // ── Private Evacuation Centers ────────────────────────────────────────────
  // "private|Barangay Lores Multipurpose Hall":                   [14.5872, 121.1792],  // NA
  "private|Piedra Blanca Multipurpose Court":                      [14.619269496257091, 121.20135278756577],
  "private|Cherry Hills Phase 2 Covered Court":                    [14.615168633485716, 121.19214324652027],
  "private|Cherry Hills Phase 1 Covered Court":                    [14.616030470673211, 121.19410045882071],
  "private|Bermuda Heights Covered Court":                         [14.59789010827697, 121.18359543674389],
  // "private|Open Court Town and Country Phase 1":                [14.6306, 121.1556],  // NA
  // "private|Open Court Town and Country Phase 4":                [14.6314, 121.1564],  // NA
  "private|Saint Anthony Covered Court":                           [14.573425308980177, 121.1906695506327],
  // "private|Villa Grande Covered Court Phase 3":                 [14.6447, 121.1427],  // NA
  // ── San Isidro ────────────────────────────────────────────────────────────
  "sanisidro|Sports Hub (city manage)":                            [14.591631601050024, 121.18180722945668],
  // "sanisidro|Barangay San Isidro Covered Court":                [14.6060, 121.1860],  // NA
  "sanisidro|Fatima Village Covered Court":                        [14.594876256044602, 121.18557382708438],
  // "sanisidro|CULDESAC Covered Court":                           [14.6075, 121.1875],  // NA
  "sanisidro|Zontaville Covered Court":                            [14.616520500196852, 121.18455932073483],
  "sanisidro|Gasak Covered Court":                                 [14.618801122504177, 121.18563263331403],
  "sanisidro|San Isidro Elementary School":                        [14.59116038461588, 121.18376176578028],
  "sanisidro|San Isidro National High School":                     [14.591326525301566, 121.19116900382352],
  "sanisidro|Bagong Nayon II Elem. School":                        [14.618234476727128, 121.18566141968334],
  "sanisidro|Bagong Nayon IV Elem. School":                        [14.615622419079143, 121.18463469640044],
  "sanisidro|Saarland Village Covered Court":                      [14.592609156098336, 121.18140927199255],
  // "sanisidro|Sitio Maligaya Covered Court":                     [14.6042, 121.1850],  // NA
  "sanisidro|Bagong Nayon II National High School":                [14.618198722478956, 121.18633128018234],
  // "sanisidro|Phase 1-OTSO Covered Court":                       [14.6085, 121.1880],  // NA
  "sanisidro|Aringit Covered Court":                               [14.61573803119965, 121.18304566065335],
  "sanisidro|Phase 1-Talipapa Covered Court":                      [14.620686188590199, 121.18562719824922],
  "sanisidro|Sitio Epheta Covered Court":                          [14.616199011152236, 121.18624416123127],
  "sanisidro|Sitio Tanglaw Covered Court":                         [14.612988244278739, 121.18679964740724],
  // ── San Jose (Boso-boso area) ─────────────────────────────────────────────
  // "sanjose|Buhanginan Covered Court":                           [14.5720, 121.2250],  // NA
  "sanjose|Boso-boso Covered Court":                               [14.640235388691014, 121.23890953615758],
  "sanjose|Tanza Covered Court":                                   [14.612583534769957, 121.2288805089379],
  // "sanjose|Sitio Kaysakat I Covered Court":                     [14.5730, 121.2260],  // NA
  "sanjose|Jesus Cabarus Elem. School & Covered Court":            [14.583685367061504, 121.20954879085416],
  "sanjose|Rizza Elementary School":                               [14.5718, 121.2248],
  "sanjose|San Joseph Elementary School":                          [14.658579139108616, 121.26962931107889],
  "sanjose|Kaysakat Elementary School":                            [14.65463300141259, 121.24649843872987],
  "sanjose|Maximo Gatlabayan Memorial Nat'l High School":          [14.623336956654812, 121.25984981888696],
  "sanjose|Old Boso-boso Elementary School":                       [14.638878577629894, 121.24272525407196],
  // ── San Juan ──────────────────────────────────────────────────────────────
  "sanjuan|Barangay Hall":                                         [14.627816439827122, 121.17699542703369],
  "sanjuan|Sitio Inalsan Covered Court":                           [14.626632922799873, 121.17645268338109],
  // "sanjuan|Sitio Inalsan Barangay Health Center":               [14.5843, 121.2273],  // NA
  // "sanjuan|Sitio Buntong Palay Barangay Day Care Center":       [14.5850, 121.2280],  // NA
  "sanjuan|Sitio Sapinit Barangay Hall Annex":                     [14.659078697643636, 121.21032851049767],
  "sanjuan|Sitio Sapinit Multipurpose Building":                   [14.658600021412045, 121.21118571009697],
  "sanjuan|Sitio Sapinit Elem. School":                            [14.659304612346594, 121.21110984577344],
  "sanjuan|San Juan National High School":                         [14.659999246197005, 121.21039564787601],
  // ── San Luis ──────────────────────────────────────────────────────────────
  "sanluis|Barangay Hall Sitio Pinagmisan":                        [14.604274012010423, 121.19814635222265],
  // "sanluis|Phase 2-B Brgy. Hall Annex":                         [14.6272, 121.1522],  // NA
  "sanluis|Phase 2 Peace Village Multipurpose Court":              [14.616067539843169, 121.1919024960305],
  "sanluis|Phase 3 Peace Village Multipurpose Court":              [14.614313010686956, 121.19401549455173],
  "sanluis|Sambaville 1 Barangay Hall":                            [14.621017402142344, 121.190346731261],
  // "sanluis|Sambaville 1 Covered Court":                         [14.6263, 121.1513],  // NA
  "sanluis|Phase 2-Barangay Hall Covered Covered Court":           [14.615166413714494, 121.19152993814707],
  // "sanluis|Piedra Covered Court":                               [14.6290, 121.1540],  // NA
  "sanluis|Antipolo Hills Covered Court":                          [14.606550865935048, 121.19465889189831],
  "sanluis|Santana Village Chapel":                                [14.592272692848313, 121.19637909640035],
  "sanluis|La Salle College open field area":                      [14.602165807580944, 121.20509917864743],
  "sanluis|Insular Homes Covered Court":                           [14.610745879385686, 121.20003357430538],
  // "sanluis|Biong Village Covered Court":                        [14.6255, 121.1505],  // NA
  "sanluis|Cherry Hills Phase 3 Covered Court":                    [14.61607638638195, 121.19411543059745],
  // "sanluis|DAHAI Bayugo Govt. House":                           [14.6310, 121.1560],  // NA
  // "sanluis|Pinagmimahan Covered Court":                         [14.6305, 121.1555],  // NA
  "sanluis|Bermuda Covered Court":                                 [14.598602503292971, 121.18359802973418],
  // "sanluis|Open Court Town and Country Phase 2":                [14.6308, 121.1558],  // NA
  // "sanluis|Open Court Town and Country Phase 3":                [14.6312, 121.1562],  // NA
  // "sanluis|Culasi Open Court":                                  [14.6248, 121.1498],  // NA
  "sanluis|Culassi Day Care Center":                               [14.62199467288296, 121.21189140353178],
  "sanluis|Culassi Chapel":                                        [14.621945961355234, 121.21170919139271],
  // "sanluis|Primavera Covered Court":                            [14.6295, 121.1545],  // NA
  // ── San Roque ─────────────────────────────────────────────────────────────
  "sanroque|Barangay San Roque Hall":                              [14.583189462591129, 121.17189778476745],
  "sanroque|Barangay Hall Day Care Center":                        [14.583270662013183, 121.17183139030193],
  "sanroque|Sumulong Elementary School":                           [14.584519695247488, 121.17349363093372],
  "sanroque|Lores Elementary School":                              [14.576482998546304, 121.17293115967466],
  "sanroque|San Roque National High School":                       [14.5710243318948, 121.1686134897288],
  "sanroque|Nazarene Covered Court":                               [14.56482919093634, 121.16813879519722],
  // "sanroque|San Agustin Covered Court":                         [14.5858, 121.1778],  // NA
  "sanroque|Cristimar Covered Court":                              [14.582403314420533, 121.17253631858418],
  // ── Santa Cruz ────────────────────────────────────────────────────────────
  "santacruz|Barangay Covered Court Ynares Multipurpose":          [14.615308478375908, 121.16935294498155],
  "santacruz|Sta. Cruz Elementary School":                         [14.615734413909227, 121.17112101026578],
  "santacruz|Lower Sto. Nino Covered Court":                       [14.61779676695133, 121.16903861555687],
};

function statusOf(center) {
  // Availability is a separate on/off flag from occupancy (see EvacuationPage's
  // "Unavailable" badge, shown alongside its own occupancy status) — a closed
  // center should read as closed on the map regardless of how full it is.
  if (center.available === false) return "closed";
  if (!center.capacity || center.occupancy === 0) return "vacant";
  const pct = center.occupancy / center.capacity;
  if (pct >= 1) return "full";
  if (pct >= 0.8) return "nearFull";
  return "active";
}

const STATUS_COLOR = {
  full: "#ef4444",
  nearFull: "#f97316",
  active: "#22c55e",
  vacant: "#94a3b8",
  closed: "#475569",
};

const STATUS_LABEL = {
  full: "Full",
  nearFull: "Near Full",
  active: "Active",
  vacant: "Vacant",
  closed: "Closed",
};

const TENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15 8.5 21"/><path d="M2 21h20"/></svg>`;

function createTentIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:32px;height:32px;border-radius:50%;background:${color};border:2.5px solid white;display:flex;align-items:center;justify-content:center;">${TENT_SVG}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -20],
  });
}

export default function EvacuationCentersLayer({ visible }) {
  const [centers, setCenters] = useState([]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch("/api/evacuation/centers?barangay=all");
      setCenters(data);
    } catch {
      // silently ignore — layer just won't render
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
    const socket = connectSocket();
    function handler({ center }) {
      setCenters((prev) =>
        prev.map((c) => (c._id === center._id ? center : c)),
      );
    }
    socket.on("evacuation_updated", handler);
    return () => socket.off("evacuation_updated", handler);
  }, [visible]);

  if (!visible) return null;

  return centers.map((center) => {
    const coords =
      center.lat != null && center.lng != null
        ? [center.lat, center.lng]
        : COORDS[`${center.barangay}|${center.name}`];

    if (!coords) return null;

    const status = statusOf(center);
    const color = STATUS_COLOR[status];
    const pct = center.capacity
      ? Math.round((center.occupancy / center.capacity) * 100)
      : 0;

    return (
      <Marker key={center._id} position={coords} icon={createTentIcon(color)}>
        <Popup>
          <div style={{ minWidth: 180 }}>
            <p style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>
              {center.name}
            </p>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
              {center.location}
            </p>
            <div
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 12,
                background: color,
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              {STATUS_LABEL[status]}
            </div>
            <p style={{ fontSize: 12, margin: 0 }}>
              <strong>{center.occupancy}</strong> / {center.capacity} evacuees
              {center.capacity > 0 && (
                <span style={{ color: "#94a3b8" }}> ({pct}%)</span>
              )}
            </p>
            {center.barangay && (
              <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                Brgy.{" "}
                {center.barangay.charAt(0).toUpperCase() +
                  center.barangay.slice(1)}
              </p>
            )}
          </div>
        </Popup>
      </Marker>
    );
  });
}
