import { CaretDown } from "@phosphor-icons/react";
import type { PersonalMemory } from "@tab/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Checkbox,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@tab/ui";
import { formatCount, formatDate } from "../pages/shared.tsx";
import { DashboardSectionContent } from "./layout.tsx";
import { MemoryRowActions } from "./row-actions.tsx";
import type { DashboardData } from "./types.ts";

const bulkDeleteMemoriesFormId = "bulk-delete-memories";

function memorySourceLabel(createdBy: PersonalMemory["createdBy"]): string {
  return createdBy === "user" ? "Saved by you" : "Learned from your writing";
}

export function MemoryBulkNoscriptFallback({ memories }: { memories: readonly PersonalMemory[] }) {
  return (
    <noscript>
      <form method="post" action="/dashboard/memories/delete-selected">
        <fieldset className="grid gap-2">
          <legend className="text-sm font-bold">Select memories to delete</legend>
          {memories.map((memory) => (
            <label className="flex items-start gap-2 text-sm" key={memory.id}>
              <input type="checkbox" name="memoryId" value={memory.id} />
              <span>{memory.content}</span>
            </label>
          ))}
        </fieldset>
        <input type="hidden" name="confirm" value="delete-selected-memories" />
        <Button type="submit" variant="destructive" size="sm">Delete selected memories</Button>
      </form>
    </noscript>
  );
}

export function DashboardMemoriesPage({ data }: { data: DashboardData }) {
  const memoryCountLabel = `${formatCount(data.memories.length)} ${data.memories.length === 1 ? "memory" : "memories"}`;

  return (
    <DashboardSectionContent section="memories">
      <section id="memories" className="grid gap-6">
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[65ch] leading-relaxed text-muted-foreground"><strong className="text-foreground">{memoryCountLabel} saved.</strong> Tab can use these details when Personal Memory is on in the Mac app.</p>
          <Button asChild variant="secondary" size="sm"><a href="/dashboard/memories/export">Export JSON</a></Button>
        </div>
        <details className="rounded-[var(--radius-card)] bg-muted/30 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-control)] py-1 text-sm font-semibold text-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>Add a memory</span>
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Up to 500 characters<CaretDown className="tab-disclosure-chevron size-4" aria-hidden="true" /></span>
          </summary>
          <form method="post" action="/dashboard/memories/create" className="tab-disclosure-panel mt-3 grid gap-3">
            <Field>
              <FieldLabel htmlFor="memory-content">Memory content</FieldLabel>
              <Textarea id="memory-content" name="content" maxLength={500} required rows={3} autoComplete="off" className="min-h-20" placeholder="Example: I prefer concise morning status summaries..." />
              <FieldDescription>Only save details you are comfortable reusing.</FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm">Save Memory</Button></div>
          </form>
        </details>
        {data.memories.length === 0 ? (
          <EmptyState title="No saved memories yet" description="Add a saved memory when you want Tab to personalize suggestions." />
        ) : (
          <div className="grid gap-3">
            <form id={bulkDeleteMemoriesFormId} method="post" action="/dashboard/memories/delete-selected" />
            <MemoryBulkNoscriptFallback memories={data.memories} />
            <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-1">
                <p className="text-sm font-bold text-foreground">Memory library</p>
                <p id="bulk-memory-delete-guidance" className="text-sm text-muted-foreground">Select one or more memories to remove them together.</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="secondary" size="sm">Delete selected...</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete selected memories?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone. If nothing is selected, no changes are made.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <input form={bulkDeleteMemoriesFormId} type="hidden" name="confirm" value="delete-selected-memories" />
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                    <Button aria-describedby="bulk-memory-delete-guidance" form={bulkDeleteMemoriesFormId} type="submit" variant="destructive">Delete selected memories</Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <Table aria-label="Saved memories">
              <caption className="sr-only">Saved memories available for personalized suggestions</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Select</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead className="hidden sm:table-cell">Source</TableHead>
                  <TableHead className="hidden md:table-cell">Updated</TableHead>
                  <TableHead className="w-16 text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.memories.map((memory) => {
                  const checkboxId = `memory-${memory.id}-selected`;
                  return (
                    <TableRow key={memory.id}>
                      <TableCell>
                        <FieldLabel htmlFor={checkboxId} className="flex size-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-muted/30 hover:bg-muted">
                          <span className="sr-only">Select memory updated {formatDate(memory.updatedAt)}</span>
                          <Checkbox id={checkboxId} form={bulkDeleteMemoriesFormId} name="memoryId" value={memory.id} />
                        </FieldLabel>
                      </TableCell>
                      <TableCell className="min-w-52 max-w-[40rem]"><p className="max-w-[65ch] whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">{memory.content}</p></TableCell>
                      <TableCell className="hidden sm:table-cell"><StatusBadge className="w-max whitespace-nowrap">{memorySourceLabel(memory.createdBy)}</StatusBadge></TableCell>
                      <TableCell className="hidden whitespace-nowrap font-[var(--font-code)] text-xs tabular-nums text-muted-foreground md:table-cell"><time dateTime={memory.updatedAt}>{formatDate(memory.updatedAt)}</time></TableCell>
                      <TableCell className="text-right align-top"><MemoryRowActions memory={memory} label={`Actions for memory updated ${formatDate(memory.updatedAt)}`} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </DashboardSectionContent>
  );
}
