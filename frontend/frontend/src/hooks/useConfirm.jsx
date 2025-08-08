import { createRoot } from "react-dom/client";
import ConfirmModal from "@/components/Controls/Modals/ConfirmModal";

export const openConfirmModal = (msg) =>
  new Promise((resolve) => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    root.render(
      <ConfirmModal
        body={msg}
        onResolve={(ok) => {
          root.unmount();
          div.remove();
          resolve(ok);
        }}
      />
    );
  });
