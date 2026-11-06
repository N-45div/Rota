import { createToolkitI18nCatalog } from "@agent-native/toolkit/app/i18n";

import enUS from "./en-US";

// Rota is English-only for now; other locales fall back to these strings.
export const i18nCatalog = createToolkitI18nCatalog({
  messages: enUS,
  localeLoaders: {},
});
