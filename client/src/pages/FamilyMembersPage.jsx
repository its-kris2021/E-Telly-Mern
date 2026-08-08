import { useState, useEffect } from "react";
import { UserRound, Search, Users } from "lucide-react";
import { API_BASE, authHeaders } from "../components/community/helpers";

export default function FamilyMembersPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/family/barangay-roster`, { headers: authHeaders() });
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body.error);
        setData(body);
      } catch {
        setError("Failed to load the family member roster.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const residents = (data?.residents ?? []).filter((r) => {
    const q = search.toLowerCase();
    return !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Family Members</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data ? `Household roster for ${data.barangayLabel}` : "Assigned barangay household roster."}
          </p>
        </div>
        {residents.length > 0 && (
          <div className="relative shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search residents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 w-56"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border-l-4 border-red-600 text-red-700 text-sm px-4 py-3 rounded">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : residents.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
          <UserRound className="mx-auto mb-2 text-gray-300" size={28} />
          {search ? "No residents match your search." : "No residents found for this barangay yet."}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
          {residents.map((r) => (
            <div key={r.residentId} className="px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500 font-mono truncate">{r.email}</p>
                  {r.address && <p className="text-xs text-gray-400 mt-0.5">{r.address}</p>}
                </div>
                <span className="shrink-0 flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">
                  <Users size={12} />
                  {r.familyMembers.length} member{r.familyMembers.length !== 1 ? "s" : ""}
                </span>
              </div>
              {r.familyMembers.length > 0 && (
                <ul className="mt-2.5 pl-1 space-y-1">
                  {r.familyMembers.map((m, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                      {m.name} <span className="text-gray-400">({m.relationship})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
