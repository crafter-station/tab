import { Desktop, Gear, Moon, SignOut, Sun, UserCircle } from "@phosphor-icons/react";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type ThemeMode,
} from "@tab/ui";
import { useTheme } from "./theme-provider.tsx";

const themeModes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Desktop },
] as const;

export function UserMenu({ user }: { user: SessionUser }) {
  const userLabel = user.email ?? user.name ?? "Account";
  const { theme, setTheme } = useTheme();
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
        <div className="flex items-center justify-between px-2 py-1" aria-label="Theme selection">
          <span className="text-xs font-medium text-muted-foreground">Theme</span>
          <DropdownMenuRadioGroup className="flex items-center gap-1" value={theme} onValueChange={(value) => setTheme(value as ThemeMode)} aria-label="Theme selection">
            {themeModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <DropdownMenuRadioItem
                  key={mode.id}
                  value={mode.id}
                  data-theme-choice={mode.id}
                  aria-label={`${mode.label} theme`}
                  title={`${mode.label} theme`}
                  className="size-7 justify-center p-0 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&>span]:hidden"
                >
                  <Icon aria-hidden="true" />
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </div>
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
