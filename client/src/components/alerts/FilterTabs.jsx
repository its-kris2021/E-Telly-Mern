const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "rescue", label: "Rescue" },
  { key: "evacuate", label: "Evacuate" },
  { key: "warning", label: "Warning" },
  { key: "watch", label: "Watch" },
];

export default function FilterTabs({ activeFilter, onFilterChange, counts }) {
  return (
    <div className="flex gap-1.5 mb-4 flex-shrink-0 overflow-x-auto scrollbar-none pb-0.5">
      {FILTER_TABS.map((tab) => {
        const isActive = activeFilter === tab.key;

        return (
          <button
            key={tab.key}
            onClick={() => onFilterChange(tab.key)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
              whitespace-nowrap transition-all flex-shrink-0
              ${
                isActive
                  ? tab.key === "rescue"
                    ? "bg-red-600 text-white shadow-sm"
                    : "bg-gray-900 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-700"
              }
            `}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
