import { useT } from "@agent-native/core/client/i18n";
import { focusAgentChat } from "@agent-native/toolkit/app/chat";
import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import {
  IconActivity,
  IconCalendarWeek,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
  IconSparkles,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import { RotaMark } from "@/components/brand/RotaMark";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed?: boolean;
  collapsible?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const itemClass = (active: boolean, collapsed: boolean) =>
  cn(
    "flex items-center text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
    collapsed ? "size-9 justify-center rounded-lg" : "h-9 w-full gap-3 rounded-lg px-3 text-sm",
  );

function WithTooltip({ collapsed, label, children }: { collapsed: boolean; label: string; children: React.ReactElement }) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavItem({ to, icon: ItemIcon, label, collapsed }: { to: string; icon: Icon; label: string; collapsed: boolean }) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <WithTooltip collapsed={collapsed} label={label}>
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={itemClass(active, collapsed)}
      >
        <ItemIcon className={cn("size-[18px] shrink-0", active && "text-primary")} strokeWidth={1.8} />
        <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
      </Link>
    </WithTooltip>
  );
}

export function Sidebar({ collapsed = false, collapsible = true, onCollapsedChange }: SidebarProps) {
  const t = useT();
  const ToggleIcon = collapsed ? IconLayoutSidebarLeftExpand : IconLayoutSidebarLeftCollapse;
  const iconButton =
    "flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        collapsed ? "w-12" : "w-full",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center", collapsed ? "justify-center px-1" : "px-4")}>
        <WithTooltip collapsed={collapsed} label={APP_TITLE}>
          <Link
            to="/roster"
            aria-label={collapsed ? APP_TITLE : undefined}
            className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <RotaMark className="size-8 shrink-0" />
            {collapsed ? null : (
              <span className="font-display truncate text-[22px] font-semibold leading-none text-sidebar-accent-foreground">
                {APP_TITLE}
              </span>
            )}
          </Link>
        </WithTooltip>
      </div>

      <nav
        aria-label={t("navigation.navigation")}
        className={cn("flex min-h-0 flex-1 flex-col gap-0.5", collapsed ? "items-center px-1 py-2" : "px-3 py-2")}
      >
        <NavItem to="/roster" icon={IconCalendarWeek} label={t("roster.nav")} collapsed={collapsed} />
        <NavItem to="/staff" icon={IconUsers} label={t("brand.navTeam")} collapsed={collapsed} />
        <NavItem to="/activity" icon={IconActivity} label={t("brand.navActivity")} collapsed={collapsed} />

        <div className={cn(collapsed ? "mt-2" : "mt-4 border-t border-sidebar-border pt-4")}>
          <WithTooltip collapsed={collapsed} label={t("brand.askRota")}>
            <button
              type="button"
              onClick={() => focusAgentChat()}
              aria-label={collapsed ? t("brand.askRota") : undefined}
              className={cn(
                itemClass(false, collapsed),
                "text-primary hover:text-primary",
                !collapsed && "bg-primary/10 hover:bg-primary/15",
              )}
            >
              <IconSparkles className="size-[18px] shrink-0" strokeWidth={1.8} />
              <span className={collapsed ? "sr-only" : "truncate font-medium"}>{t("brand.askRota")}</span>
            </button>
          </WithTooltip>
          {collapsed ? null : <p className="mt-2 px-3 text-xs leading-relaxed text-sidebar-foreground/80">{t("brand.askRotaHint")}</p>}
        </div>
      </nav>

      <div className="mt-auto shrink-0 border-t border-sidebar-border p-2">
        <div className={cn(collapsed ? "flex flex-col items-center gap-1" : "flex items-center gap-0.5")}>
          <OrgSwitcher
            reserveSpace
            compact={collapsed}
            currentAppId="chat"
            className={
              collapsed
                ? "size-8 bg-transparent p-0 hover:bg-sidebar-accent"
                : "min-w-0 flex-1 h-11 rounded-lg bg-transparent px-3 py-2 text-sm text-sidebar-accent-foreground hover:bg-sidebar-accent"
            }
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={openCommandMenu} aria-label={t("root.commandSearch")} className={iconButton}>
                <IconSearch className="size-4" strokeWidth={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t("root.commandSearch")}</TooltipContent>
          </Tooltip>
          {collapsible ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onCollapsedChange?.(!collapsed)}
                  className={iconButton}
                  aria-label={collapsed ? t("navigation.expandSidebar") : t("navigation.collapseSidebar")}
                >
                  <ToggleIcon className="size-4" strokeWidth={1.8} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? t("navigation.expandSidebar") : t("navigation.collapseSidebar")}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
