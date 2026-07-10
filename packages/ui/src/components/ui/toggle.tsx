import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@tab/ui/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] text-[13px] font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-[var(--tab-ease-out)] active:scale-[0.97] hover:bg-[var(--tab-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:pointer-events-none disabled:scale-100 disabled:opacity-50 data-[state=on]:bg-[var(--tab-surface-raised)] data-[state=on]:text-foreground data-[state=on]:shadow-[var(--tab-shadow-control)] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent hover:border-ring/45",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }
