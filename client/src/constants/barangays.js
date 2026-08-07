// Mirrors server/config/barangays.js BARANGAY_LABELS — keep both in sync.
// Used for barangay_official account assignment (ManageUsersPage) so the
// value sent to POST/PUT /api/users matches the server's canonical keys.
export const BARANGAY_OPTIONS = [
  { value: "bagongnayon", label: "Bagong Nayon" },
  { value: "beverlyhills", label: "Beverly Hills" },
  { value: "calawis", label: "Calawis" },
  { value: "cupang", label: "Cupang" },
  { value: "dalig", label: "Dalig" },
  { value: "delapaz", label: "Dela Paz" },
  { value: "inarawan", label: "Inarawan" },
  { value: "mambugan", label: "Mambugan" },
  { value: "mayamot", label: "Mayamot" },
  { value: "muntindilaw", label: "Muntindilaw" },
  { value: "private", label: "Private Subdivision" },
  { value: "sanisidro", label: "San Isidro" },
  { value: "sanjose", label: "San Jose" },
  { value: "sanjuan", label: "San Juan" },
  { value: "sanluis", label: "San Luis" },
  { value: "sanroque", label: "San Roque" },
  { value: "santacruz", label: "Santa Cruz" },
];

export function barangayLabel(key) {
  return BARANGAY_OPTIONS.find((b) => b.value === key)?.label ?? key;
}
