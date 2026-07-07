"use client"

import { BellRing, ScrollText, Settings } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useAlerts } from "@/components/console/alerts-provider"
import { BasepairMark } from "@/components/basepair-mark"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const NAV_ITEMS = [
  { title: "Alerts", icon: BellRing, href: "/" },
  { title: "Audit", icon: ScrollText, href: "/audit" },
  // Settings has no destination yet; it stays an inert button.
  { title: "Settings", icon: Settings, href: null },
] as const

/** Which nav item the current path belongs to. The Alerts item owns the queue
 *  and every `/alerts/[id]` detail route; Audit owns `/audit`. */
function isActive(href: string | null, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/alerts")
  if (href) return pathname === href || pathname.startsWith(`${href}/`)
  return false
}

/**
 * Console shell navigation. The chrome recedes and stays static; it reads the
 * live open count from context (hence a client component), while only the queue
 * below it is interactive.
 */
export function AppSidebar() {
  const { openCount } = useAlerts()
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center text-foreground"
          >
            <BasepairMark className="w-5" />
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Basepair
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive(item.href, pathname)}
                    tooltip={item.title}
                    render={
                      item.href ? (
                        <Link href={item.href} aria-label={item.title} />
                      ) : (
                        <button type="button" aria-label={item.title} />
                      )
                    }
                  >
                    <item.icon aria-hidden />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.title === "Alerts" && openCount > 0 && (
                    <SidebarMenuBadge>{openCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Priya Nair, PharmD"
              render={<button type="button" aria-label="Priya Nair, PharmD" />}
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
              >
                PN
              </span>
              <span className="grid text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">Priya Nair</span>
                <span className="truncate text-xs text-muted-foreground">
                  PharmD
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
