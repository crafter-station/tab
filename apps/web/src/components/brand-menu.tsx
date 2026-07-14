import { Copy, House, Palette, SquaresFour } from "@phosphor-icons/react";
import { TAB_LOCKUP_SVG, TAB_MARK_SVG } from "@tab/ui/brand-assets";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  TabMark,
  cn,
} from "@tab/ui";

type BrandMenuProps = {
  triggerClassName?: string;
  wordmarkClassName?: string;
};

const navigation = [
  { href: "/", label: "Home page", icon: House },
  { href: "/brand", label: "Brand page", icon: Palette },
  { href: "/dashboard", label: "Dashboard", icon: SquaresFour },
] as const;

function copySvg(svg: string) {
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(svg).catch((error) => console.error("Could not copy SVG", error));
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = svg;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function BrandLockup({ wordmarkClassName }: { wordmarkClassName?: string }) {
  return (
    <span className="relative flex size-5 shrink-0" aria-hidden="true">
      <TabMark className="size-5 text-primary [&_svg]:!size-full" />
      <span className={cn("absolute left-7 top-0 whitespace-nowrap font-[var(--font-display)] text-sm font-bold tracking-[-0.025em] text-foreground", wordmarkClassName)}>Tab</span>
    </span>
  );
}

export function BrandMenu({
  triggerClassName,
  wordmarkClassName,
}: BrandMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button asChild variant="ghost" className={cn("group/brand-menu h-10 w-[4.75rem] justify-start px-1.5 data-[state=open]:bg-[var(--tab-hover)] data-[state=open]:text-foreground", triggerClassName)}>
          <a href="/" aria-label="Tab home. Right-click for menu">
            <BrandLockup wordmarkClassName={wordmarkClassName} />
          </a>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 p-2">
        <ContextMenuGroup>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <ContextMenuItem asChild className="py-2.5 font-semibold" key={item.href}>
                <a href={item.href}>
                  <Icon aria-hidden="true" />
                  {item.label}
                </a>
              </ContextMenuItem>
            );
          })}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem className="py-2.5 font-semibold" onSelect={() => copySvg(TAB_MARK_SVG)}>
            <Copy aria-hidden="true" />
            Copy logo as SVG
          </ContextMenuItem>
          <ContextMenuItem className="py-2.5 font-semibold" onSelect={() => copySvg(TAB_LOCKUP_SVG)}>
            <Copy aria-hidden="true" />
            Copy logo + wordmark as SVG
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
