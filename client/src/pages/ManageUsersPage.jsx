import { useState, useEffect, useRef } from "react";
import { X, Pencil, Trash2, UserCog, Copy, KeyRound, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import ModalShell from "../components/ui/ModalShell";
import { ROLE_LABELS } from "../config/roleModules";
import { BARANGAY_OPTIONS, barangayLabel } from "../config/barangays";

const API_BASE  = import.meta.env.PROD
  ? window.location.origin
  : (import.meta.env?.VITE_API_BASE ?? `http://${window.location.hostname}:5000`);
const PAGE_SIZE = 7;

// Residents are never created/managed here — self-registration is mobile-only.
const ROLE_OPTIONS = [
  { key: "system_admin",      label: ROLE_LABELS.system_admin      },
  { key: "cdrrmo",            label: ROLE_LABELS.cdrrmo            },
  { key: "barangay_official", label: ROLE_LABELS.barangay_official },
];

function getRoleLabel(role) {
  return ROLE_LABELS[role] ?? "Resident";
}

function getRoleBadge(role) {
  if (role === "system_admin")      return "bg-purple-100 text-purple-700";
  if (role === "cdrrmo")            return "bg-red-100 text-red-700";
  if (role === "barangay_official") return "bg-blue-100 text-blue-700";
  return "bg-green-100 text-green-700";
}

export default function ManageUsersPage() {
  const [users,           setUsers]           = useState([]);
  const [searchQuery,     setSearchQuery]     = useState("");
  const [selectedRoles,   setSelectedRoles]   = useState([]);
  const [page,            setPage]            = useState(1);
  const [isModalOpen,     setIsModalOpen]     = useState(false);
  const [isEditMode,      setIsEditMode]      = useState(false);
  const [selectedUser,    setSelectedUser]    = useState(null);
  const [menuState,       setMenuState]       = useState(null);
  const [isLoading,       setIsLoading]       = useState(false);
  const [alert,           setAlert]           = useState("");
  const [alertType,       setAlertType]       = useState("success");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [showPassword,    setShowPassword]    = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [userToDelete,    setUserToDelete]    = useState(null);
  const [resetResult,     setResetResult]     = useState(null);
  const [filterOpen,      setFilterOpen]      = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const filterRef = useRef(null);

  const [formData, setFormData] = useState({
    email: "", firstName: "", lastName: "", role: "barangay_official", assignedBarangay: "", password: "",
  });

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Auto email ──────────────────────────────────────────────────────────────
  const buildEmail = (firstName, lastName) => {
    const first = firstName.trim();
    const last  = lastName.trim();
    if (!first && !last) return "";
    const cleanLast     = last.replace(/\s+/g, "");
    const lastFormatted = cleanLast.charAt(0).toUpperCase() + cleanLast.slice(1);
    return `${lastFormatted}${first.charAt(0).toUpperCase()}@etelly.com`;
  };

  const handleNameChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (!isEditMode) {
        next.email = buildEmail(
          field === "firstName" ? value : prev.firstName,
          field === "lastName"  ? value : prev.lastName,
        );
      }
      return next;
    });
  };

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("token");
      const res   = await fetch(`${API_BASE}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setUsers(data);
    } catch {
      showAlert("Failed to fetch users", "error");
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const showAlert = (message, type = "success") => {
    setAlert(message);
    setAlertType(type);
    setTimeout(() => setAlert(""), 3000);
  };

  const getFirstName = (n) => n?.split(" ")[0] || "";
  const getLastName  = (n) => n?.split(" ").slice(1).join(" ") || "";

  const toggleRole = (role) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
    setPage(1);
  };

  // ── Filter + paginate ───────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q           = searchQuery.toLowerCase();
    const matchSearch = u.email.toLowerCase().includes(q) ||
                        u.name?.toLowerCase().includes(q) ||
                        getRoleLabel(u.role).toLowerCase().includes(q);
    const matchRole   = selectedRoles.length === 0 || selectedRoles.includes(u.role);
    return matchSearch && matchRole;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── Fixed-position action menu ──────────────────────────────────────────────
  const handleMenuToggle = (e, userId) => {
    if (menuState?.userId === userId) { setMenuState(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuState({ userId, top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  const menuUser       = menuState ? users.find(u => u._id === menuState.userId) : null;
  const isResidentMenu = menuUser?.role === "user";

  // ── Password validation ─────────────────────────────────────────────────────
  const pwRules = [
    { label: "At least 8 characters",       test: (p) => p.length >= 8 },
    { label: "One uppercase letter (A–Z)",  test: (p) => /[A-Z]/.test(p) },
    { label: "One lowercase letter (a–z)",  test: (p) => /[a-z]/.test(p) },
    { label: "One number (0–9)",            test: (p) => /[0-9]/.test(p) },
    { label: "One special character",       test: (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
  ];
  const isPasswordValid = (p) => pwRules.every(r => r.test(p));

  // ── Password ────────────────────────────────────────────────────────────────
  const generatePassword = () => {
    const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower   = "abcdefghjkmnpqrstuvwxyz";
    const digits  = "23456789";
    const special = "!@#$%^&*";
    const all     = upper + lower + digits + special;
    const chars   = [
      upper  [Math.floor(Math.random() * upper.length)],
      upper  [Math.floor(Math.random() * upper.length)],
      lower  [Math.floor(Math.random() * lower.length)],
      lower  [Math.floor(Math.random() * lower.length)],
      digits [Math.floor(Math.random() * digits.length)],
      digits [Math.floor(Math.random() * digits.length)],
      special[Math.floor(Math.random() * special.length)],
      special[Math.floor(Math.random() * special.length)],
    ];
    while (chars.length < 16) chars.push(all[Math.floor(Math.random() * all.length)]);
    const pw = chars.sort(() => Math.random() - 0.5).join("");
    setGeneratedPassword(pw);
    setFormData(prev => ({ ...prev, password: pw }));
    setShowPassword(true);
  };

  const copyPassword = async () => {
    const pw = generatedPassword || formData.password;
    if (!pw) return showAlert("No password to copy!", "error");
    await navigator.clipboard.writeText(pw);
    showAlert("Password copied to clipboard!");
  };

  const handleResetPassword = async (user) => {
    setMenuState(null);
    setIsLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res   = await fetch(`${API_BASE}/api/users/${user._id}/reset-password`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setResetResult({ name: user.name, tempPassword: data.tempPassword });
    } catch (err) {
      showAlert(err.message || "Failed to reset password", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const handleOpenCreateModal = () => {
    setIsEditMode(false);
    setSelectedUser(null);
    setGeneratedPassword("");
    setShowPassword(false);
    setPasswordTouched(false);
    setFormData({ email: "", firstName: "", lastName: "", role: "barangay_official", assignedBarangay: "", password: "" });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (user) => {
    setIsEditMode(true);
    setSelectedUser(user);
    setGeneratedPassword("");
    setShowPassword(false);
    setFormData({
      email: user.email, firstName: getFirstName(user.name),
      lastName: getLastName(user.name), role: user.role,
      assignedBarangay: user.assignedBarangay || "", password: "",
    });
    setIsModalOpen(true);
    setMenuState(null);
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!isPasswordValid(formData.password)) {
      setPasswordTouched(true);
      return;
    }
    if (formData.role === "barangay_official" && !formData.assignedBarangay) {
      showAlert("Select an assigned barangay for this Barangay Official.", "error");
      return;
    }
    setIsLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res   = await fetch(`${API_BASE}/api/users`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showAlert("User created successfully!");
      setIsModalOpen(false);
      fetchUsers();
    } catch (err) {
      showAlert(err.message || "Failed to create user", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (formData.role === "barangay_official" && !formData.assignedBarangay) {
      showAlert("Select an assigned barangay for this Barangay Official.", "error");
      return;
    }
    setIsLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res   = await fetch(`${API_BASE}/api/users/${selectedUser._id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showAlert("User updated successfully!");
      setIsModalOpen(false);
      fetchUsers();
    } catch (err) {
      showAlert(err.message || "Failed to update user", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const openDeleteConfirmation = (userId) => {
    setUserToDelete(userId);
    setShowDeleteConfirm(true);
    setMenuState(null);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    setIsLoading(true);
    setShowDeleteConfirm(false);
    try {
      const token = localStorage.getItem("token");
      const res   = await fetch(`${API_BASE}/api/users/${userToDelete}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showAlert("User deleted successfully!");
      fetchUsers();
    } catch (err) {
      showAlert(err.message || "Failed to delete user", "error");
    } finally {
      setIsLoading(false);
      setUserToDelete(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* Toast */}
      {alert && (
        <div className={`fixed top-4 right-4 z-50 bg-white px-6 py-3 rounded-lg shadow-lg border-l-4 max-w-md
          ${alertType === "error" ? "border-red-600" : "border-green-600"}`}>
          <p className="text-gray-900 font-medium">{alert}</p>
          <button onClick={() => setAlert("")} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Manage Users</h1>
        <button
          onClick={handleOpenCreateModal}
          className="px-4 sm:px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm sm:text-base"
        >
          + Create User
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, email or role..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
        />
      </div>

      {/* Mobile filter */}
      <div className="md:hidden mb-4">
        <button
          onClick={() => setMobileFilterOpen(o => !o)}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors
            ${selectedRoles.length > 0
              ? "border-red-500 text-red-600 bg-red-50"
              : "border-gray-300 text-gray-600 bg-white hover:bg-gray-50"}`}
        >
          <ListFilter size={14} />
          Filter by Role
          {selectedRoles.length > 0 && (
            <span className="text-xs bg-red-600 text-white rounded-full px-1.5 py-0.5 leading-none">
              {selectedRoles.length}
            </span>
          )}
        </button>
        {mobileFilterOpen && (
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            {ROLE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => toggleRole(opt.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                  ${selectedRoles.includes(opt.key)
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}
              >
                {opt.label}
              </button>
            ))}
            {selectedRoles.length > 0 && (
              <button
                onClick={() => { setSelectedRoles([]); setPage(1); }}
                className="text-xs text-red-500 hover:text-red-700 px-1 py-1.5 underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="relative flex items-center gap-1.5" ref={filterRef}>
                  Role
                  <button
                    onClick={() => setFilterOpen(o => !o)}
                    className={`flex items-center gap-0.5 p-0.5 rounded hover:bg-gray-200 transition-colors
                      ${selectedRoles.length > 0 ? "text-red-600" : "text-gray-400"}`}
                    title="Filter by role"
                  >
                    <ListFilter size={13} />
                    {selectedRoles.length > 0 && (
                      <span className="text-[10px] bg-red-600 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">
                        {selectedRoles.length}
                      </span>
                    )}
                  </button>
                  {filterOpen && (
                    <div className="absolute top-full left-0 mt-1.5 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1.5 z-50">
                      {ROLE_OPTIONS.map(opt => (
                        <label
                          key={opt.key}
                          className="flex items-center gap-2.5 px-4 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedRoles.includes(opt.key)}
                            onChange={() => toggleRole(opt.key)}
                            className="accent-red-600 cursor-pointer"
                          />
                          <span className="text-sm text-gray-700 font-normal normal-case tracking-normal">
                            {opt.label}
                          </span>
                        </label>
                      ))}
                      {selectedRoles.length > 0 && (
                        <div className="border-t border-gray-100 mt-1 pt-1 px-4">
                          <button
                            onClick={() => { setSelectedRoles([]); setPage(1); setFilterOpen(false); }}
                            className="text-xs text-red-500 hover:text-red-700 py-1"
                          >
                            Clear filter
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {paginated.map(user => (
              <tr key={user._id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{user.name}</td>
                <td className="px-6 py-4 font-mono text-gray-500">{user.email}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getRoleBadge(user.role)}`}>
                    {getRoleLabel(user.role)}
                    {user.role === "barangay_official" && user.assignedBarangay && ` — ${barangayLabel(user.assignedBarangay)}`}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={(e) => handleMenuToggle(e, user._id)}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <UserCog size={18} className="text-gray-500" />
                  </button>
                </td>
              </tr>
            ))}
            {Array.from({ length: PAGE_SIZE - paginated.length }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td className="px-6 py-4">&nbsp;</td>
                <td /><td /><td />
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
          <span className="text-xs text-gray-400">
            {filtered.length === 0 ? "No users found" : `${filtered.length} user${filtered.length !== 1 ? "s" : ""}`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-semibold text-gray-500">{safePage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-3">
        {paginated.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-200 text-gray-500 text-sm">
            No users found
          </div>
        )}
        {paginated.map(user => (
          <div key={user._id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{user.email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${getRoleBadge(user.role)}`}>
                  {getRoleLabel(user.role)}
                </span>
                <button
                  onClick={(e) => handleMenuToggle(e, user._id)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <UserCog size={16} className="text-gray-500" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {totalPages > 1 && (
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-semibold text-gray-500">{safePage} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── Fixed-position action menu ── */}
      {menuState && menuUser && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuState(null)} />
          <div
            className="fixed z-50 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1"
            style={{ top: menuState.top, right: menuState.right }}
          >
            {!isResidentMenu && (
              <button
                onClick={() => handleOpenEditModal(menuUser)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700"
              >
                <Pencil size={14} /> Edit
              </button>
            )}
            {!isResidentMenu && (
              <button
                onClick={() => handleResetPassword(menuUser)}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 text-amber-600 flex items-center gap-2"
              >
                <KeyRound size={14} /> Reset Password
              </button>
            )}
            <button
              onClick={() => openDeleteConfirmation(menuUser._id)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 text-red-600 flex items-center gap-2"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </>
      )}

      {/* ── Create / Edit modal ── */}
      {isModalOpen && (
        <ModalShell onClose={() => setIsModalOpen(false)} size="md">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {isEditMode ? "Edit User" : "Create New User"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={isEditMode ? handleUpdateUser : handleCreateUser} className="p-6">
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                    <input
                      type="text" value={formData.firstName}
                      onChange={(e) => handleNameChange("firstName", e.target.value)}
                      className="text-sm w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2"
                      required disabled={isLoading} placeholder="Juan"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                    <input
                      type="text" value={formData.lastName}
                      onChange={(e) => handleNameChange("lastName", e.target.value)}
                      className="text-sm w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2"
                      required disabled={isLoading} placeholder="Dela Cruz"
                    />
                  </div>
                </div>

                {!isEditMode && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">System Login Email</label>
                      {formData.email && <span className="text-xs text-blue-500 font-medium">auto-generated</span>}
                    </div>
                    <input
                      type="email" value={formData.email} readOnly
                      className="text-sm w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg font-mono text-gray-600 cursor-default"
                      placeholder="Fill in the name fields above" tabIndex={-1}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value, assignedBarangay: e.target.value === "barangay_official" ? formData.assignedBarangay : "" })}
                    className="text-sm w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 cursor-pointer"
                    disabled={isLoading}
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {formData.role === "barangay_official" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Barangay</label>
                    <select
                      value={formData.assignedBarangay}
                      onChange={(e) => setFormData({ ...formData, assignedBarangay: e.target.value })}
                      className="text-sm w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 cursor-pointer"
                      disabled={isLoading}
                      required
                    >
                      <option value="">Select a barangay…</option>
                      {BARANGAY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {!isEditMode && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                    <div className="flex gap-2">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={formData.password}
                        onChange={(e) => {
                          setFormData({ ...formData, password: e.target.value });
                          setPasswordTouched(true);
                        }}
                        className={`flex-1 px-4 py-2 bg-gray-50 border rounded-lg focus:outline-none focus:ring-2 font-mono text-sm
                          ${passwordTouched && !isPasswordValid(formData.password)
                            ? "border-red-400 focus:ring-red-300"
                            : "border-gray-200 focus:ring-blue-300"}`}
                        required disabled={isLoading} placeholder="Min 8 characters"
                      />
                      <button type="button" onClick={copyPassword}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg" title="Copy password">
                        <Copy size={18} className="text-gray-600" />
                      </button>
                      <button type="button" onClick={generatePassword}
                        className="px-2 py-1 text-xs text-gray-700 font-medium bg-white hover:bg-gray-200 rounded-lg border border-gray-400">
                        Generate
                      </button>
                    </div>
                    {(passwordTouched || formData.password) && (
                      <ul className="mt-2 space-y-1">
                        {pwRules.map((rule) => {
                          const passed = rule.test(formData.password);
                          return (
                            <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${passed ? "text-green-600" : "text-gray-400"}`}>
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0
                                ${passed ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                                {passed ? "✓" : "·"}
                              </span>
                              {rule.label}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-8">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                  disabled={isLoading}>
                  Cancel
                </button>
                <button type="submit"
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                  disabled={isLoading}>
                  {isLoading ? "Saving..." : isEditMode ? "Update User" : "Create User"}
                </button>
              </div>
            </form>
        </ModalShell>
      )}

      {/* ── Reset password result ── */}
      {resetResult && (
        <ModalShell onClose={() => setResetResult(null)} size="sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                <KeyRound size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Password Reset</h3>
                <p className="text-sm text-gray-500">{resetResult.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Share this temporary password with the user. They will be required to set a new password on their next login.
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3 mb-5">
              <span className="font-mono text-sm font-semibold text-gray-900 break-all">{resetResult.tempPassword}</span>
              <button
                onClick={async () => { await navigator.clipboard.writeText(resetResult.tempPassword); showAlert("Temporary password copied!"); }}
                className="shrink-0 p-1.5 hover:bg-gray-200 rounded"
              >
                <Copy size={15} className="text-gray-500" />
              </button>
            </div>
            <button onClick={() => setResetResult(null)}
              className="w-full py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
              Done
            </button>
          </div>
        </ModalShell>
      )}

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <ModalShell onClose={() => { setShowDeleteConfirm(false); setUserToDelete(null); }} size="sm">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-2">Confirm Delete</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this user? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDeleteConfirm(false); setUserToDelete(null); }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button onClick={confirmDeleteUser}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                disabled={isLoading}>
                {isLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
