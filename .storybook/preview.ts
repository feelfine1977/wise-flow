import type { Preview } from "@storybook/react";
import "@xyflow/react/dist/style.css";
import "../src/tokens.css";
import "../src/react/style.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    backgrounds: { disable: true },
    options: {
      storySort: { order: ["Process map", "Stable layout", "Overlays", "Table alternative", "Trace timeline"] },
    },
  },
};

export default preview;
