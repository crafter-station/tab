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
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="max-w-56 truncate">{userLabel}</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem asChild><a href="/dashboard"><UserCircle />Dashboard</a></DropdownMenuItem>
          <DropdownMenuItem asChild><a href="/dashboard/account"><Gear />Settings</a></DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <form method="post" action="/logout">
            <DropdownMenuItem asChild>
              <Button className="h-auto w-full justify-start rounded-sm border-0 bg-transparent px-2 py-1.5 text-sm font-normal text-foreground shadow-none hover:bg-accent hover:text-accent-foreground" type="submit" variant="ghost"><SignOut />Sign out</Button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
