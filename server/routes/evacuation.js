import express from "express";
import EvacuationCenter from "../models/EvacuationCenter.js";
import EvacuationLog from "../models/EvacuationLog.js";
import User from "../models/user.js";
import { protect, requireRole, rejectIfOutsideAssignedBarangay } from "../middleware/auth.js";
import { BARANGAY_COORDS } from "../config/barangays.js";

const router = express.Router();

// ── Exact center coordinates (mirrors EvacuationCentersLayer.jsx COORDS) ──────
// Used server-side so the mobile API response always includes lat/lng.
const CENTER_COORDS = {
  "bagongnayon|Barangay Hall Gym Covered Court":                   [14.626080463429222, 121.16871690148847],
  "bagongnayon|Barangay Hall Health Center":                       [14.626031269517606, 121.16872812183026],
  "bagongnayon|Barangay Hall School Day Care Center":              [14.626087624405825, 121.16887413021486],
  "bagongnayon|Cogeo 1 Daycare center":                            [14.629750801995282, 121.16331878286434],
  "bagongnayon|Livelihood Center":                                 [14.626109935902823, 121.16872579313947],
  "bagongnayon|Conference Covered Court":                          [14.630069345738608, 121.16359796898647],
  "beverlyhills|Barangay Hall 2-storey Bldg.":                     [14.584244406427,    121.15782963101199],
  "beverlyhills|Barangay Covered Court":                           [14.58439566569219,  121.15855847789283],
  "calawis|Barangay Hall":                                         [14.670879986725202, 121.24209717965446],
  "calawis|Calawis Covered Court Purok 6":                         [14.684555648253808, 121.24376143708587],
  "calawis|Calawis Elementary School":                             [14.673404678543303, 121.24229561839971],
  "calawis|Calawis National High School":                          [14.685114989824527, 121.24340322552595],
  "calawis|Calawis Day Care Center":                               [14.671506868865407, 121.24171849010925],
  "cupang|Barangay Hall Covered Court":                            [14.636011615678756, 121.12392432145741],
  "cupang|Area Dela Paz Court":                                    [14.631422942291007, 121.13829389640073],
  "cupang|Villa Grande Covered Court":                             [14.650098085700224, 121.13494455246101],
  "cupang|Panorama Hills Covered Court":                           [14.638668166183225, 121.13461805722737],
  "cupang|Taguete Covered Court":                                  [14.631941203306484, 121.13625475136024],
  "cupang|Sierra Vista Covered Court":                             [14.633882781387186, 121.12686838518528],
  "cupang|Manseta Covered Court":                                  [14.640685171055502, 121.13527865222312],
  "dalig|Barangay Hall Multipurpose Covered Court":                [14.572675564139795, 121.18655860513668],
  "dalig|Isaias Tapales Elementary School":                        [14.580167937449684, 121.17846380124182],
  "dalig|Kamatisan Covered Court":                                 [14.577078993805666, 121.17762280780528],
  "dalig|Dalig National High School":                              [14.575235498344712, 121.19293404477926],
  "delapaz|Barangay Hall Main Hall":                               [14.588837091950742, 121.17419327562496],
  "delapaz|Barangay Hall Annex":                                   [14.619188581325641, 121.18012783156549],
  "delapaz|Barangay Hall Annex Covered Court Purok Imelda":        [14.619485456649823, 121.17989274408907],
  "delapaz|Dela Paz National High School":                         [14.590530891343356, 121.17031075407138],
  "delapaz|Sitio Ivory Covered Court":                             [14.61530734321826,  121.17221725516985],
  "delapaz|Palmera V Covered Court":                               [14.591931457195026, 121.15274151198956],
  "delapaz|Green Forest Multipurpose Hall":                        [14.617985783513582, 121.17518328649908],
  "inarawan|Inarawan Livelihood Center (Barangay)":                [14.624821158684705, 121.18046215307378],
  "inarawan|Maagay 3 Day Care Center":                             [14.623805986227822, 121.18991675407160],
  "inarawan|Inuman Elementary School":                             [14.624910672743516, 121.21733266756495],
  "mambugan|Mambugan Elementary School and Covered Court":         [14.618483880397369, 121.13573485171437],
  "mambugan|Siruna National High School and Covered Court":        [14.623307096083186, 121.14212288724956],
  "mambugan|Mambugan Barangay Hall":                               [14.620590337149023, 121.14163390927600],
  "mambugan|La Colina Covered Court":                              [14.611047451086046, 121.13644952261694],
  "mayamot|Kingsville Evacuation Center (City Manage)":            [14.624668116713282, 121.12326876756502],
  "mayamot|Kingsville Evacuation Center( City Manage)":            [14.6005,            121.1885           ],
  "mayamot|Mayamot Elementary School Covered Court":               [14.630235215057867, 121.12078721478203],
  "muntindilaw|Muntindilaw National High School":                  [14.598892299749012, 121.13014110586640],
  "muntindilaw|Barangay Covered Court":                            [14.598388909557519, 121.13064521221689],
  "muntindilaw|Skylark St. Vista Verde Bldg.":                     [14.599849871072996, 121.12710159596216],
  "muntindilaw|Skylark St. Visit Verde Bldg.":                     [14.599351160807533, 121.12645693758138],
  "muntindilaw|Saint Martin De Porres":                            [14.599604146066408, 121.13108183175862],
  "muntindilaw|Sitio Mahayahay Open Court BC":                     [14.602175569836161, 121.12824760770297],
  "muntindilaw|Muntindilaw Elementary School":                     [14.597602829812942, 121.12625230539115],
  "muntindilaw|Muntindilaw Elem. School":                          [14.597602829812942, 121.12625230539115],
  "muntindilaw|Village East Clubhouse Basketball Court":           [14.601092575253976, 121.11462557667842],
  "muntindilaw|Vista Verde Executive Basketball Court":            [14.604062008363243, 121.11487412939127],
  "private|Piedra Blanca Multipurpose Court":                      [14.619269496257091, 121.20135278756577],
  "private|Cherry Hills Phase 2 Covered Court":                    [14.615168633485716, 121.19214324652027],
  "private|Cherry Hills Phase 1 Covered Court":                    [14.616030470673211, 121.19410045882071],
  "private|Bermuda Heights Covered Court":                         [14.597890108276970, 121.18359543674389],
  "private|Saint Anthony Covered Court":                           [14.573425308980177, 121.19066955063270],
  "sanisidro|Sports Hub (city manage)":                            [14.591631601050024, 121.18180722945668],
  "sanisidro|Fatima Village Covered Court":                        [14.594876256044602, 121.18557382708438],
  "sanisidro|Zontaville Covered Court":                            [14.616520500196852, 121.18455932073483],
  "sanisidro|Gasak Covered Court":                                 [14.618801122504177, 121.18563263331403],
  "sanisidro|San Isidro Elementary School":                        [14.591160384615880, 121.18376176578028],
  "sanisidro|San Isidro National High School":                     [14.591326525301566, 121.19116900382352],
  "sanisidro|Bagong Nayon II Elem. School":                        [14.618234476727128, 121.18566141968334],
  "sanisidro|Bagong Nayon IV Elem. School":                        [14.615622419079143, 121.18463469640044],
  "sanisidro|Saarland Village Covered Court":                      [14.592609156098336, 121.18140927199255],
  "sanisidro|Bagong Nayon II National High School":                [14.618198722478956, 121.18633128018234],
  "sanisidro|Aringit Covered Court":                               [14.615738031199650, 121.18304566065335],
  "sanisidro|Phase 1-Talipapa Covered Court":                      [14.620686188590199, 121.18562719824922],
  "sanisidro|Sitio Epheta Covered Court":                          [14.616199011152236, 121.18624416123127],
  "sanisidro|Sitio Tanglaw Covered Court":                         [14.612988244278739, 121.18679964740724],
  "sanjose|Boso-boso Covered Court":                               [14.640235388691014, 121.23890953615758],
  "sanjose|Tanza Covered Court":                                   [14.612583534769957, 121.22888050893790],
  "sanjose|Jesus Cabarus Elem. School & Covered Court":            [14.583685367061504, 121.20954879085416],
  "sanjose|Rizza Elementary School":                               [14.5718,            121.2248           ],
  "sanjose|San Joseph Elementary School":                          [14.658579139108616, 121.26962931107889],
  "sanjose|Kaysakat Elementary School":                            [14.654633001412590, 121.24649843872987],
  "sanjose|Maximo Gatlabayan Memorial Nat'l High School":          [14.623336956654812, 121.25984981888696],
  "sanjose|Old Boso-boso Elementary School":                       [14.638878577629894, 121.24272525407196],
  "sanjuan|Barangay Hall":                                         [14.627816439827122, 121.17699542703369],
  "sanjuan|Sitio Inalsan Covered Court":                           [14.626632922799873, 121.17645268338109],
  "sanjuan|Sitio Sapinit Barangay Hall Annex":                     [14.659078697643636, 121.21032851049767],
  "sanjuan|Sitio Sapinit Multipurpose Building":                   [14.658600021412045, 121.21118571009697],
  "sanjuan|Sitio Sapinit Elem. School":                            [14.659304612346594, 121.21110984577344],
  "sanjuan|San Juan National High School":                         [14.659999246197005, 121.21039564787601],
  "sanluis|Barangay Hall Sitio Pinagmisan":                        [14.604274012010423, 121.19814635222265],
  "sanluis|Phase 2 Peace Village Multipurpose Court":              [14.616067539843169, 121.19190249603050],
  "sanluis|Phase 3 Peace Village Multipurpose Court":              [14.614313010686956, 121.19401549455173],
  "sanluis|Sambaville 1 Barangay Hall":                            [14.621017402142344, 121.19034673126100],
  "sanluis|Phase 2-Barangay Hall Covered Covered Court":           [14.615166413714494, 121.19152993814707],
  "sanluis|Antipolo Hills Covered Court":                          [14.606550865935048, 121.19465889189831],
  "sanluis|Santana Village Chapel":                                [14.592272692848313, 121.19637909640035],
  "sanluis|La Salle College open field area":                      [14.602165807580944, 121.20509917864743],
  "sanluis|Insular Homes Covered Court":                           [14.610745879385686, 121.20003357430538],
  "sanluis|Cherry Hills Phase 3 Covered Court":                    [14.616076386381950, 121.19411543059745],
  "sanluis|Bermuda Covered Court":                                 [14.598602503292971, 121.18359802973418],
  "sanluis|Culassi Day Care Center":                               [14.621994672882960, 121.21189140353178],
  "sanluis|Culassi Chapel":                                        [14.621945961355234, 121.21170919139271],
  "sanroque|Barangay San Roque Hall":                              [14.583189462591129, 121.17189778476745],
  "sanroque|Barangay Hall Day Care Center":                        [14.583270662013183, 121.17183139030193],
  "sanroque|Sumulong Elementary School":                           [14.584519695247488, 121.17349363093372],
  "sanroque|Lores Elementary School":                              [14.576482998546304, 121.17293115967466],
  "sanroque|San Roque National High School":                       [14.571024331894800, 121.16861348972880],
  "sanroque|Nazarene Covered Court":                               [14.564829190936340, 121.16813879519722],
  "sanroque|Cristimar Covered Court":                              [14.582403314420533, 121.17253631858418],
  "santacruz|Barangay Covered Court Ynares Multipurpose":          [14.615308478375908, 121.16935294498155],
  "santacruz|Sta. Cruz Elementary School":                         [14.615734413909227, 121.17112101026578],
  "santacruz|Lower Sto. Nino Covered Court":                       [14.617796766951330, 121.16903861555687],
};

// ── Barangay emergency hotlines (mirrors EvacuationPage.jsx BARANGAYS) ────────
// Served on each center so the mobile app's Call button can dial the first number.
const BARANGAY_HOTLINES = {
  bagongnayon:  ["0945-624-8906", "0962-391-2390"],
  beverlyhills: ["0930-027-6922", "8518-2988", "0966-661-4839"],
  calawis:      ["0994-833-9165"],
  cupang:       ["0968-491-8172", "0910-524-9816", "0953-669-4295", "682-4946", "682-4837"],
  dalig:        ["0968-491-8172", "0910-524-9816"],
  delapaz:      ["8260-0182", "0960-604-4446"],
  inarawan:     ["0956-084-5977"],
  mambugan:     ["0928-776-7525", "0998-475-1517"],
  mayamot:      ["0918-288-7373", "0939-811-1094", "8470-6121", "8470-7935", "8880-4373", "8470-8924"],
  muntindilaw:  ["8463-0534", "0917-515-1764"],
  sanisidro:    ["0933-829-7656", "0933-815-9319"],
  sanjose:      ["0966-448-6020", "0915-388-9567", "8818-4641"],
  sanjuan:      ["0968-602-8496", "8296-0453"],
  sanluis:      ["0956-442-2732", "0967-291-4584", "0935-532-5076", "0922-420-3099", "8696-7370"],
  sanroque:     ["0945-624-8906", "0962-391-2390"],
  santacruz:    ["0927-687-5203", "0928-620-6373", "0951-301-2629", "0912-985-1208", "8534-1105"],
  private:      [],
};

// Barangay-level fallback when no exact name match exists.
// BARANGAY_COORDS now lives in ../config/barangays.js (shared with the hazard
// rule engine and AI prediction engine) — imported above.

// ── Seed data ─────────────────────────────────────────────────────────────────
const SEED = [
  // Barangay Bagong Nayon
  {
    barangay: "bagongnayon",
    name: "Bagong Nayon Elementary School",
    location: "Bagong Nayon",
    capacity: 400,
  },
  {
    barangay: "bagongnayon",
    name: "Barangay Hall",
    location: "Bagong Nayon",
    capacity: 150,
  },
  {
    barangay: "bagongnayon",
    name: "Barangay Covered Court",
    location: "Bagong Nayon",
    capacity: 200,
  },
  {
    barangay: "bagongnayon",
    name: "Bagong Nayon National High School",
    location: "Bagong Nayon",
    capacity: 500,
  },

  // Barangay Beverly Hills
  {
    barangay: "beverlyhills",
    name: "Beverly Hills Elementary School",
    location: "Beverly Hills",
    capacity: 350,
  },
  {
    barangay: "beverlyhills",
    name: "Barangay Hall",
    location: "Beverly Hills",
    capacity: 150,
  },
  {
    barangay: "beverlyhills",
    name: "Barangay Covered Court",
    location: "Beverly Hills",
    capacity: 200,
  },

  // Barangay Calawis
  {
    barangay: "calawis",
    name: "Calawis Elementary School",
    location: "Calawis",
    capacity: 300,
  },
  {
    barangay: "calawis",
    name: "Barangay Hall",
    location: "Calawis",
    capacity: 100,
  },
  {
    barangay: "calawis",
    name: "Barangay Covered Court",
    location: "Calawis",
    capacity: 150,
  },

  // Barangay Cupang
  {
    barangay: "cupang",
    name: "Cupang National High School",
    location: "Cupang",
    capacity: 500,
  },
  {
    barangay: "cupang",
    name: "Cupang Elementary School",
    location: "Cupang",
    capacity: 400,
  },
  {
    barangay: "cupang",
    name: "Barangay Hall",
    location: "Cupang",
    capacity: 150,
  },
  {
    barangay: "cupang",
    name: "Barangay Covered Court",
    location: "Cupang",
    capacity: 200,
  },
  {
    barangay: "cupang",
    name: "Cupang Daycare Center",
    location: "Cupang",
    capacity: 80,
  },

  // Barangay Dalig
  {
    barangay: "dalig",
    name: "Dalig Elementary School",
    location: "Dalig",
    capacity: 350,
  },
  {
    barangay: "dalig",
    name: "Barangay Hall",
    location: "Dalig",
    capacity: 150,
  },
  {
    barangay: "dalig",
    name: "Barangay Covered Court",
    location: "Dalig",
    capacity: 200,
  },

  // Barangay Dela Paz
  {
    barangay: "delapaz",
    name: "Dela Paz National High School",
    location: "Dela Paz",
    capacity: 600,
  },
  {
    barangay: "delapaz",
    name: "Dela Paz Elementary School",
    location: "Dela Paz",
    capacity: 400,
  },
  {
    barangay: "delapaz",
    name: "Barangay Hall",
    location: "Dela Paz",
    capacity: 150,
  },
  {
    barangay: "delapaz",
    name: "Barangay Covered Court",
    location: "Dela Paz",
    capacity: 200,
  },
  {
    barangay: "delapaz",
    name: "Dela Paz Daycare Center",
    location: "Dela Paz",
    capacity: 80,
  },

  // Barangay Inarawan
  {
    barangay: "inarawan",
    name: "Inarawan Elementary School",
    location: "Inarawan",
    capacity: 300,
  },
  {
    barangay: "inarawan",
    name: "Barangay Hall",
    location: "Inarawan",
    capacity: 100,
  },
  {
    barangay: "inarawan",
    name: "Barangay Covered Court",
    location: "Inarawan",
    capacity: 150,
  },

  // Barangay Mambugan
  {
    barangay: "mambugan",
    name: "Mambugan Elementary School",
    location: "Mambugan",
    capacity: 350,
  },
  {
    barangay: "mambugan",
    name: "Mambugan National High School",
    location: "Mambugan",
    capacity: 500,
  },
  {
    barangay: "mambugan",
    name: "Barangay Hall",
    location: "Mambugan",
    capacity: 150,
  },
  {
    barangay: "mambugan",
    name: "Barangay Covered Court",
    location: "Mambugan",
    capacity: 200,
  },

  // Barangay Mayamot
  {
    barangay: "mayamot",
    name: "Kingsville Evacuation Center (City Manage)",
    location: "Kingsville Subd.",
    capacity: 200,
  },
  {
    barangay: "mayamot",
    name: "Mayamot Elementary School Covered Court",
    location: "147 Sumulong Hi-way",
    capacity: 300,
  },
  {
    barangay: "mayamot",
    name: "Mayamot Daycare Center",
    location: "Sumulong Hi-way",
    capacity: 80,
  },

  // Barangay Muntindilaw
  {
    barangay: "muntindilaw",
    name: "Puno Multipurpose Hall – Rescue Bldg.",
    location: "Barangay Compound",
    capacity: 300,
  },
  {
    barangay: "muntindilaw",
    name: "Muntindilaw National High School",
    location: "Duluth Brookside Subdivision",
    capacity: 500,
  },
  {
    barangay: "muntindilaw",
    name: "Barangay Covered Court",
    location: "Barangay Covered Court",
    capacity: 200,
  },
  {
    barangay: "muntindilaw",
    name: "Area 4B Basketball Open Court",
    location: "Palm Drive Country Homes",
    capacity: 150,
  },
  {
    barangay: "muntindilaw",
    name: "Skylark St. Vista Verde Bldg.",
    location: "Skylark St., Country Homes",
    capacity: 100,
  },
  {
    barangay: "muntindilaw",
    name: "Saint Martin De Porres",
    location: "San Martin de Porres",
    capacity: 200,
  },
  {
    barangay: "muntindilaw",
    name: "Sitio Mahayahay Open Court BC",
    location: "Sitio Mahayahay, Country Homes",
    capacity: 150,
  },
  {
    barangay: "muntindilaw",
    name: "Muntindilaw Daycare Center",
    location: "Barangay Compound",
    capacity: 80,
  },
  {
    barangay: "muntindilaw",
    name: "Muntindilaw Elementary School",
    location: "Barangay Compound",
    capacity: 400,
  },
  {
    barangay: "muntindilaw",
    name: "KB 4 Open Area Basketball Court",
    location: "Woodpeaker St., Country Homes",
    capacity: 150,
  },
  {
    barangay: "muntindilaw",
    name: "Village East Clubhouse Basketball Court",
    location: "L'Village East Avenue",
    capacity: 200,
  },
  {
    barangay: "muntindilaw",
    name: "Vista Verde Executive Basketball Court",
    location: "Alfonso St., Vista Verde",
    capacity: 150,
  },

  // Private Centers
  {
    barangay: "private",
    name: "La Colina Sports Complex",
    location: "La Colina",
    capacity: 500,
  },
  {
    barangay: "private",
    name: "Robinsons Place Antipolo",
    location: "Sumulong Hi-way",
    capacity: 1000,
  },
  {
    barangay: "private",
    name: "SM Masinag",
    location: "Masinag, Antipolo",
    capacity: 1200,
  },

  // Barangay San Isidro
  {
    barangay: "sanisidro",
    name: "San Isidro Elementary School",
    location: "San Isidro",
    capacity: 350,
  },
  {
    barangay: "sanisidro",
    name: "San Isidro National High School",
    location: "San Isidro",
    capacity: 500,
  },
  {
    barangay: "sanisidro",
    name: "Barangay Hall",
    location: "San Isidro",
    capacity: 150,
  },
  {
    barangay: "sanisidro",
    name: "Barangay Covered Court",
    location: "San Isidro",
    capacity: 200,
  },

  // Barangay San Jose
  {
    barangay: "sanjose",
    name: "San Jose National High School",
    location: "San Jose",
    capacity: 600,
  },
  {
    barangay: "sanjose",
    name: "San Jose Elementary School",
    location: "San Jose",
    capacity: 400,
  },
  {
    barangay: "sanjose",
    name: "Barangay Hall",
    location: "San Jose",
    capacity: 150,
  },
  {
    barangay: "sanjose",
    name: "Barangay Covered Court",
    location: "San Jose",
    capacity: 200,
  },
  {
    barangay: "sanjose",
    name: "San Jose Daycare Center",
    location: "San Jose",
    capacity: 80,
  },

  // Barangay San Juan
  {
    barangay: "sanjuan",
    name: "San Juan Elementary School",
    location: "San Juan",
    capacity: 350,
  },
  {
    barangay: "sanjuan",
    name: "Barangay Hall",
    location: "San Juan",
    capacity: 150,
  },
  {
    barangay: "sanjuan",
    name: "Barangay Covered Court",
    location: "San Juan",
    capacity: 200,
  },

  // Barangay San Luis
  {
    barangay: "sanluis",
    name: "San Luis National High School",
    location: "San Luis",
    capacity: 600,
  },
  {
    barangay: "sanluis",
    name: "San Luis Elementary School",
    location: "San Luis",
    capacity: 400,
  },
  {
    barangay: "sanluis",
    name: "Barangay Hall",
    location: "San Luis",
    capacity: 150,
  },
  {
    barangay: "sanluis",
    name: "Barangay Covered Court",
    location: "San Luis",
    capacity: 200,
  },
  {
    barangay: "sanluis",
    name: "San Luis Daycare Center",
    location: "San Luis",
    capacity: 80,
  },

  // Barangay San Roque
  {
    barangay: "sanroque",
    name: "San Roque Elementary School",
    location: "San Roque",
    capacity: 350,
  },
  {
    barangay: "sanroque",
    name: "San Roque National High School",
    location: "San Roque",
    capacity: 500,
  },
  {
    barangay: "sanroque",
    name: "Barangay Hall",
    location: "San Roque",
    capacity: 150,
  },
  {
    barangay: "sanroque",
    name: "Barangay Covered Court",
    location: "San Roque",
    capacity: 200,
  },

  // Barangay Santa Cruz
  {
    barangay: "santacruz",
    name: "Santa Cruz National High School",
    location: "Santa Cruz",
    capacity: 600,
  },
  {
    barangay: "santacruz",
    name: "Santa Cruz Elementary School",
    location: "Santa Cruz",
    capacity: 400,
  },
  {
    barangay: "santacruz",
    name: "Barangay Hall",
    location: "Santa Cruz",
    capacity: 150,
  },
  {
    barangay: "santacruz",
    name: "Barangay Covered Court",
    location: "Santa Cruz",
    capacity: 200,
  },
  {
    barangay: "santacruz",
    name: "Santa Cruz Daycare Center",
    location: "Santa Cruz",
    capacity: 80,
  },
];

async function seedIfEmpty(barangay) {
  const count = await EvacuationCenter.countDocuments({ barangay });
  if (count === 0) {
    await EvacuationCenter.insertMany(
      SEED.filter((s) => s.barangay === barangay),
    );
    console.log(`[Evacuation] Seeded ${barangay} centers`);
  }
}

// Resolve the caller's display name from JWT (may include name after our auth update)
// or fall back to a DB lookup so existing sessions still get a real name.
async function resolveUserName(req) {
  if (req.user.name) return req.user.name;
  const user = await User.findById(req.user.id).select("name").lean();
  return user?.name ?? "Unknown";
}

// ── GET /api/evacuation/centers?barangay=... ─────────────────────────────────
router.get("/centers", protect, async (req, res) => {
  try {
    const { barangay = "muntindilaw" } = req.query;
    if (barangay === "all") {
      const allBarangays = [...new Set(SEED.map((s) => s.barangay))];
      await Promise.all(allBarangays.map(seedIfEmpty));
    } else {
      await seedIfEmpty(barangay);
    }
    const filter = barangay === "all" ? {} : { barangay };
    const centers = await EvacuationCenter.find(filter).sort({ barangay: 1, name: 1 });

    // Only return centers that are listed in CENTER_COORDS (the authoritative list
    // from EvacuationCentersLayer.jsx), or that the admin manually gave coordinates.
    // SEED-generated centers with no COORDS entry are excluded.
    const withCoords = centers
      .map((c) => {
        const obj = c.toObject();
        const key = `${obj.barangay}|${obj.name}`;
        const exact = CENTER_COORDS[key];

        // Attach barangay hotlines + the primary number the mobile app dials.
        const hotlines = BARANGAY_HOTLINES[obj.barangay] ?? [];
        obj.hotlines = hotlines;
        obj.contact = hotlines[0] ?? "";

        if (exact) {
          // Always use the known precise coordinate (fills in null DB coords too)
          if (obj.lat == null || obj.lng == null) {
            [obj.lat, obj.lng] = exact;
          }
          return obj;
        }
        // No COORDS entry — only include if admin explicitly set coordinates
        if (obj.lat != null && obj.lng != null) return obj;
        return null;
      })
      .filter(Boolean);

    res.json(withCoords);
  } catch (err) {
    console.error("❌ Evacuation centers fetch:", err.message);
    res.status(500).json({ message: "Failed to fetch centers" });
  }
});

// ── PUT /api/evacuation/centers/:id/occupancy ────────────────────────────────
router.put("/centers/:id/occupancy", protect, requireRole("cdrrmo"), async (req, res) => {
  try {
    const userName = await resolveUserName(req);
    const center = await EvacuationCenter.findById(req.params.id);
    if (!center) return res.status(404).json({ message: "Center not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, center.barangay)) return;

    const prev = center.occupancy;
    const next = Math.max(
      0,
      Math.min(center.capacity, parseInt(req.body.occupancy, 10)),
    );
    if (isNaN(next))
      return res.status(400).json({ message: "Invalid occupancy value" });

    center.occupancy = next;
    center.updatedBy = { userId: req.user.id, userName };
    await center.save();

    const log = await EvacuationLog.create({
      centerId: center._id,
      centerName: center.name,
      barangay: center.barangay,
      action: "occupancy_update",
      previousValue: prev,
      newValue: next,
      delta: next - prev,
      user: { id: req.user.id, name: userName },
    });

    req.app.get("io").emit("evacuation_updated", { center, log });
    res.json({ center, log });
  } catch (err) {
    console.error("❌ Occupancy update:", err.message);
    res.status(500).json({ message: "Failed to update occupancy" });
  }
});

// ── PUT /api/evacuation/centers/:id/capacity ─────────────────────────────────
router.put("/centers/:id/capacity", protect, requireRole("cdrrmo"), async (req, res) => {
  try {
    const userName = await resolveUserName(req);
    const center = await EvacuationCenter.findById(req.params.id);
    if (!center) return res.status(404).json({ message: "Center not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, center.barangay)) return;

    const prev = center.capacity;
    const next = Math.max(1, parseInt(req.body.capacity, 10));
    if (isNaN(next))
      return res.status(400).json({ message: "Invalid capacity value" });

    center.capacity = next;
    center.occupancy = Math.min(center.occupancy, next);
    center.updatedBy = { userId: req.user.id, userName };
    await center.save();

    const log = await EvacuationLog.create({
      centerId: center._id,
      centerName: center.name,
      barangay: center.barangay,
      action: "capacity_update",
      previousValue: prev,
      newValue: next,
      delta: next - prev,
      user: { id: req.user.id, name: userName },
    });

    req.app.get("io").emit("evacuation_updated", { center, log });
    res.json({ center, log });
  } catch (err) {
    console.error("❌ Capacity update:", err.message);
    res.status(500).json({ message: "Failed to update capacity" });
  }
});

// ── POST /api/evacuation/centers/:id/reset ───────────────────────────────────
router.post("/centers/:id/reset", protect, requireRole("cdrrmo"), async (req, res) => {
  try {
    const userName = await resolveUserName(req);
    const center = await EvacuationCenter.findById(req.params.id);
    if (!center) return res.status(404).json({ message: "Center not found" });
    if (rejectIfOutsideAssignedBarangay(req, res, center.barangay)) return;

    const prev = center.occupancy;
    center.occupancy = 0;
    center.updatedBy = { userId: req.user.id, userName };
    await center.save();

    const log = await EvacuationLog.create({
      centerId: center._id,
      centerName: center.name,
      barangay: center.barangay,
      action: "reset",
      previousValue: prev,
      newValue: 0,
      delta: -prev,
      user: { id: req.user.id, name: userName },
    });

    req.app.get("io").emit("evacuation_updated", { center, log });
    res.json({ center, log });
  } catch (err) {
    console.error("❌ Reset:", err.message);
    res.status(500).json({ message: "Failed to reset occupancy" });
  }
});

// ── PUT /api/evacuation/centers/:id/availability ─────────────────────────────
router.put(
  "/centers/:id/availability",
  protect,
  requireRole("cdrrmo"),
  async (req, res) => {
    try {
      const userName = await resolveUserName(req);
      const center = await EvacuationCenter.findById(req.params.id);
      if (!center) return res.status(404).json({ message: "Center not found" });

      const prev = center.available !== false;
      const next = !!req.body.available;

      center.available = next;
      center.updatedBy = { userId: req.user.id, userName };
      await center.save();

      const log = await EvacuationLog.create({
        centerId: center._id,
        centerName: center.name,
        barangay: center.barangay,
        action: "availability_update",
        previousValue: prev ? 1 : 0,
        newValue: next ? 1 : 0,
        delta: 0,
        user: { id: req.user.id, name: userName },
      });

      req.app.get("io").emit("evacuation_updated", { center, log });
      res.json({ center, log });
    } catch (err) {
      console.error("❌ Availability update:", err.message);
      res.status(500).json({ message: "Failed to update availability" });
    }
  },
);

// ── POST /api/evacuation/centers (CDRRMO — full center management) ───────────
router.post("/centers", protect, requireRole("cdrrmo"), async (req, res) => {
  try {
    const userName = await resolveUserName(req);
    const { name, location, barangay, capacity, lat, lng } = req.body;
    if (!name?.trim() || !location?.trim() || !barangay || !capacity) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const cap = Math.max(1, parseInt(capacity, 10));
    if (isNaN(cap))
      return res.status(400).json({ message: "Invalid capacity" });

    const center = await EvacuationCenter.create({
      name: name.trim(),
      location: location.trim(),
      barangay,
      capacity: cap,
      lat: lat != null ? parseFloat(lat) : null,
      lng: lng != null ? parseFloat(lng) : null,
    });

    await EvacuationLog.create({
      centerId: center._id,
      centerName: center.name,
      barangay: center.barangay,
      action: "center_created",
      previousValue: 0,
      newValue: cap,
      delta: 0,
      user: { id: req.user.id, name: userName },
    });

    req.app.get("io").emit("evacuation_center_created", { center });
    res.status(201).json(center);
  } catch (err) {
    console.error("❌ Create center:", err.message);
    res.status(500).json({ message: "Failed to create center" });
  }
});

// ── GET /api/evacuation/logs?barangay=...&limit=50 ───────────────────────────
router.get("/logs", protect, async (req, res) => {
  try {
    const { barangay, limit = 50 } = req.query;
    const query = barangay ? { barangay } : {};
    const logs = await EvacuationLog.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10), 200));
    res.json(logs);
  } catch (err) {
    console.error("❌ Logs fetch:", err.message);
    res.status(500).json({ message: "Failed to fetch logs" });
  }
});

export default router;
