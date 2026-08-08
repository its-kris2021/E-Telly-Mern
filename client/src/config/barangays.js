// Mirrors server/config/barangays.js BARANGAY_KEYS/BARANGAY_LABELS — the
// canonical set of Antipolo City barangay keys used for Barangay Official
// account assignment (see ManageUsersPage.jsx).
export const BARANGAY_LABELS = {
  bagongnayon:  "Bagong Nayon",
  beverlyhills: "Beverly Hills",
  calawis:      "Calawis",
  cupang:       "Cupang",
  dalig:        "Dalig",
  delapaz:      "Dela Paz",
  inarawan:     "Inarawan",
  mambugan:     "Mambugan",
  mayamot:      "Mayamot",
  muntindilaw:  "Muntindilaw",
  private:      "Private Subdivision",
  sanisidro:    "San Isidro",
  sanjose:      "San Jose",
  sanjuan:      "San Juan",
  sanluis:      "San Luis",
  sanroque:     "San Roque",
  santacruz:    "Santa Cruz",
};

export const BARANGAY_OPTIONS = Object.entries(BARANGAY_LABELS).map(([value, label]) => ({ value, label }));

export function barangayLabel(key) {
  return BARANGAY_LABELS[key] ?? key;
}
