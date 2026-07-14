import { Gear, SignOut, UserCircle } from "@phosphor-icons/react";
import type { SessionUser } from "@tab/contracts";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tab/ui";

export function UserMenu({ user }: { user: SessionUser }) {
  const userLabel = user.email ?? user.name ?? "Account";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="rounded-full p-1" aria-label="Open user menu">
          <Avatar className="size-8">
            <AvatarFallback>{userLabel.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 text-[13px]">
        <DropdownMenuLabel className="max-w-52 truncate text-[13px]">{userLabel}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem asChild><a href="/dashboard"><UserCircle />Dashboard</a></DropdownMenuItem>
          <DropdownMenuItem asChild><a href="/dashboard/account"><Gear />Settings</a></DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <form method="post" action="/logout">
            <DropdownMenuItem asChild>
              <button className="flex w-full items-center gap-2 text-left" type="submit"><SignOut />Sign out</button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
