import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (config) => {
    config.optimizeDeps = {
      ...(config.optimizeDeps ?? {}),
      include: [
        ...(config.optimizeDeps?.include ?? []),
        "elkjs/lib/elk.bundled.js",
        "elkjs/lib/elk-api.js",
        "@dagrejs/dagre",
        "bpmn-moddle",
        "bpmn-js/lib/NavigatedViewer",
        "bpmn-js/lib/Modeler",
        "bpmn-js/lib/features/outline",
      ],
    };
    return config;
  },
};

export default config;
