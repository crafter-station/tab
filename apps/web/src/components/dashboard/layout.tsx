import { Brain, ChartBar, Desktop, House, UserCircle } from "@phosphor-icons/react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  SurfaceHeader,
} from "@tab/ui";
import { BrandMenu } from "../brand-menu.tsx";
import type { DashboardSection } from "./types.ts";

const dashboardNavigation = [
  { id: "overview", routeId: "/dashboard/", href: "/dashboard", label: "Overview", icon: House },
  { id: "account", routeId: "/dashboard/account", href: "/dashboard/account", label: "Account", icon: UserCircle },
  { id: "usage", routeId: "/dashboard/usage", href: "/dashboard/usage", label: "Usage and billing", icon: ChartBar },
  { id: "devices", routeId: "/dashboard/devices", href: "/dashboard/devices", label: "Devices", icon: Desktop },
  { id: "memories", routeId: "/dashboard/memories", href: "/dashboard/memories", label: "Personal Memory", icon: Brain },
] as const;

const dashboardSectionCopy: Record<DashboardSection, { title: string; description: string }> = {
  overview: { title: "Dashboard", description: "Your Tab activity this month." },
  account: { title: "Account", description: "Email and sign-in status." },
  usage: { title: "Usage and billing", description: "Review this month's activity and manage your plan." },
  devices: { title: "Devices", description: "Review Macs with access to your account." },
  memories: { title: "Personal Memory", description: "Add, review, export, or delete details Tab can use in Suggestions." },
};

function DashboardSidebar() {
  const activeRouteId = useRouterState({
    select: (state) => state.matches[state.matches.length - 1]?.routeId,
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-2">
        <BrandMenu
          destinationHref="/"
          destinationLabel="Home page"
          triggerClassName="h-12 w-full justify-start overflow-hidden px-1.5 group-data-[collapsible=icon]:!w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          wordmarkClassName="dashboard-sidebar-label"
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {dashboardNavigation.map((item) => {
                const Icon = item.icon;
                const active = activeRouteId === item.routeId;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label} className="h-10 group-data-[collapsible=icon]:!h-10">
                      <a href={item.href} aria-current={active ? "page" : undefined}>
                        <Icon aria-hidden="true" />
                        <span className="dashboard-sidebar-label">{item.label}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

export function DashboardSectionContent({ section, children }: { section: DashboardSection; children: ReactNode }) {
  const copy = dashboardSectionCopy[section];
  return (
    <div className="grid gap-10">
      <SurfaceHeader title={copy.title} description={copy.description} headingLevel={1} />
      {children}
    </div>
  );
}

export function DashboardLayout() {
  return (
    <SidebarProvider>
      <DashboardSidebar />
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <p className="truncate text-sm font-semibold">Tab account</p>
          </div>
        </header>
        <main id="main-content" className="w-full flex-1 px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
          <div className="mx-auto w-full max-w-6xl"><Outlet /></div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
