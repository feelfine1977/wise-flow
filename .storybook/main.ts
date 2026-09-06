import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  docs: { autodocs: false },
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
      ],
    };
    return config;
  },
};

export default config;
