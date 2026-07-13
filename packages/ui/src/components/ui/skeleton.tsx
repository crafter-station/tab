import { cn } from "@tab/ui/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-primary/10 motion-reduce:animate-none motion-reduce:opacity-65",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
