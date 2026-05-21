import "ketcher-react/dist/index.css";
import "@/styles/ketcher-overrides.css";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import type { Ketcher } from "ketcher-core";

const structServiceProvider = new StandaloneStructServiceProvider();

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

export function KetcherCanvas() {
  return (
    <div className="h-full w-full" data-testid="ketcher-canvas">
      <Editor
        staticResourcesUrl=""
        structServiceProvider={structServiceProvider}
        errorHandler={(err) => console.error("[ketcher]", err)}
        onInit={(ketcher) => {
          // Expose Ketcher API for Playwright + the PropertiesPanel.
          window.ketcher = ketcher;
          // NOTE: do NOT call editor.options() here. Setting render options
          // (e.g. showStereoFlags / stereoLabelStyle) corrupts Ketcher's
          // selection-highlight rendering so that selecting a molecule draws
          // stray green lines from the canvas origin to every atom. We tried it
          // to hide the absolute-stereo "ABS" flag but it broke selection, so
          // the flag stays visible (standard stereo notation).
        }}
      />
    </div>
  );
}
