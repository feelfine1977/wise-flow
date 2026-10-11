import type { Preview } from "@storybook/react";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "../src/tokens.css";
import "./flow.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    backgrounds: { disable: true },
    options: {
      storySort: { order: ["Process map", "Interaction", "Layout", "Canvas", "Stable layout", "Overlays", "BPMN", "Views", "Table alternative", "Trace timeline"] },
    },
  },
};

export default preview;
