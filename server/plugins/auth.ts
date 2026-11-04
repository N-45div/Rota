import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  marketing: {
    appName: "Rota",
    tagline: "Your AI shift manager",
    description:
      "Rota drafts your weekly staff roster, keeps it within your rules, and handles call-outs on Telegram while you watch the board.",
    features: [
      "Drafts a fair week in seconds, from skills, availability, and each person's notes",
      "Staff text in sick on Telegram; Rota asks the best people to cover",
      "Every change is checked against your rules before it's saved",
    ],
  },
});
