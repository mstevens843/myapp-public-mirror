import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { TerminalSquare } from "lucide-react"; // ⬅️ add to your import block

export default function ViewFullRunningModal({ open, onClose, config, botId }) {
  if (!config) return null;

  const { strategy, name, config: cfg } = config;
  const sortedKeys = Object.keys(cfg || {}).sort();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {name || `${capitalize(strategy)} Config (Running)`}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-zinc-300">
            {sortedKeys.map((key) => (
              <div key={key} className="flex items-start gap-2">
                <span className="font-medium text-zinc-400">{key}:</span>
                <span className="truncate max-w-[160px] break-all">
                  {renderValue(cfg[key])}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="mt-4 flex justify-end">
  <button
    onClick={() => {
      window.dispatchEvent(
        new CustomEvent("setLogsTarget", {
          detail: {
            botId,
            strategy,
            config: cfg,
          },
        })
      );
      onClose(); // close modal after firing
    }}
      className="flex items-center gap-1 text-xs px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
>
  <TerminalSquare size={14} /> View Logs in Console
</button>
</div>
      </DialogContent>
    </Dialog>
  );
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderValue(value) {
  if (typeof value === "boolean") return value ? "✅ true" : "⛔ false";
  if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
    if (entries.length === 0) return "0"; // 🧠 Nothing toggled
    return (
      <div className="flex flex-col gap-[2px]">
        {Object.entries(value).map(([k, v]) => (
          <Badge key={k} variant={v ? "default" : "secondary"}>
            {k}: {v ? "✅" : "⛔"}
          </Badge>
        ))}
      </div>
    );
  }
  return String(value);
}
