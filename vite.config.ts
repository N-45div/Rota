import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];
function devHost() {
  const host = process.env.DEV_HOST; // guard:allow-env-credential — dev server bind address, not a credential
  return host ? { server: { host } } : {};
}

export default defineConfig({
  // The framework binds to "::" (IPv6) by default. Set DEV_HOST=127.0.0.1 on
  // machines without IPv6, such as some cloud sandboxes.
  ...devHost(),
  optimizeDeps: {
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/{Layout,Sidebar}.tsx",
      "app/components/chat/ChatRouteContent.tsx",
      "app/routes/{home,chat.$threadId}.tsx",
    ],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
    }),
  ],
});
