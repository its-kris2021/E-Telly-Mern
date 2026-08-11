import { Sparkles } from "lucide-react";
import ModelPerformancePanel from "../components/admin/ModelPerformancePanel";

export default function ModelPerformancePage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles size={20} className="text-violet-400" />
          AI Model Performance
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Version history and real-world outcome tracking for the hazard risk model.
        </p>
      </div>

      <ModelPerformancePanel defaultOpen />
    </div>
  );
}
