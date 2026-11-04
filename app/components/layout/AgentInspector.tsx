import { navigateWithAgentChatViewTransition } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { chatThreadPath } from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";

interface AgentInspectorProps {
  children: ReactNode;
  chatHomeHandoffActive: boolean;
  chatHomeHandoffPending: boolean;
}

/** Contextual inspector shell used on secondary chat routes. */
export function AgentInspector({
  children,
  chatHomeHandoffActive,
  chatHomeHandoffPending,
}: AgentInspectorProps) {
  const navigate = useNavigate();
  const t = useT();
  const { pathname } = useLocation();
  const page = pathname.startsWith("/roster")
    ? "roster"
    : pathname.startsWith("/staff")
      ? "staff"
      : pathname.startsWith("/activity")
        ? "activity"
        : "other";
  const emptyStateText = {
    roster: t("roster.agentEmptyState"),
    staff: t("team.agentEmptyState"),
    activity: t("activity.agentEmptyState"),
    other: t("roster.agentEmptyState"),
  }[page];
  const suggestions = {
    roster: [t("roster.suggestDraft"), t("roster.suggestCallout"), t("roster.suggestRule")],
    staff: [t("team.suggestAvailability"), t("team.suggestAdd"), t("team.suggestTelegram")],
    activity: [t("activity.suggestToday"), t("activity.suggestOpen"), t("activity.suggestWeek")],
    other: [t("roster.suggestDraft"), t("roster.suggestCallout"), t("roster.suggestRule")],
  }[page];

  function openAskAgentFullscreen(threadId?: string) {
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId));
  }

  return (
    <AgentSidebar
      position="right"
      chatViewTransition
      chatViewTransitionHandoff={chatHomeHandoffPending}
      storageKey="chat"
      browserTabId={TAB_ID}
      openOnChatRunning={chatHomeHandoffActive}
      onFullscreenRequest={openAskAgentFullscreen}
      emptyStateText={emptyStateText}
      agentPageHref="/settings/agent"
      suggestions={suggestions}
    >
      {children}
    </AgentSidebar>
  );
}
