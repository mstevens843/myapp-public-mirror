import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ErrorBoundary
 * - Shows a friendly fallback with actions when a child throws.
 * - Buttons: Refresh (reloads page) and Return to Dashboard (/app).
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught an error", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    window.location.assign("/app");
  };

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="min-h-[60vh] flex items-center justify-center bg-black">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-3">
              <AlertTriangle className="text-amber-400" size={20} />
              <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
            </div>
            <p className="mb-6 text-sm text-zinc-400">
              The page crashed. You can reload, or head back to your dashboard.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={this.handleReload}>
                Refresh
              </Button>
              <Button className="bg-emerald-600 text-white" onClick={this.handleHome}>
                Return to Dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
