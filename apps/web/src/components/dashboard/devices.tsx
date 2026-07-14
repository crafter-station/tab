import { EmptyState, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tab/ui";
import { formatCount, formatDate } from "../pages/shared.tsx";
import { DashboardSectionContent } from "./layout.tsx";
import { DeviceRowActions } from "./row-actions.tsx";
import type { DashboardData } from "./types.ts";

export function DashboardDevicesPage({ data }: { data: DashboardData }) {
  const activeDeviceCount = data.devices.filter((device) => !device.revoked).length;

  return (
    <DashboardSectionContent section="devices">
      <section id="devices" className="grid gap-6">
        <p className="text-sm text-muted-foreground"><strong className="text-foreground">{formatCount(activeDeviceCount)} connected.</strong> Remove any Mac you no longer use.</p>
        {data.devices.length === 0 ? (
          <EmptyState title="No linked devices" description="No Macs are connected yet. Sign in from the Mac app to connect one." />
        ) : (
          <Table aria-label="Connected Macs">
            <caption className="sr-only">Connected Macs and access status</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead className="hidden sm:table-cell">Platform</TableHead>
                <TableHead className="hidden md:table-cell">Version</TableHead>
                <TableHead className="hidden lg:table-cell">Added</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell className="max-w-40 break-all font-[var(--font-code)] text-xs">{device.deviceId}</TableCell>
                  <TableCell className="hidden sm:table-cell">{device.platform}</TableCell>
                  <TableCell className="hidden md:table-cell">{device.appVersion}</TableCell>
                  <TableCell className="hidden lg:table-cell">{formatDate(device.createdAt)}</TableCell>
                  <TableCell><StatusBadge tone={device.revoked ? "neutral" : "success"}>{device.revoked ? "Access removed" : "Connected"}</StatusBadge></TableCell>
                  <TableCell className="text-right align-top">{device.revoked ? null : <DeviceRowActions deviceId={device.deviceId} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </DashboardSectionContent>
  );
}
