import { DotsThree, NotePencil, Trash } from "@phosphor-icons/react";
import { useRef, useState, type RefObject } from "react";
import type { PersonalMemory } from "@tab/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldLabel,
  Textarea,
} from "@tab/ui";

function ActionMenuTrigger({ label, triggerRef }: { label: string; triggerRef: RefObject<HTMLButtonElement | null> }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button ref={triggerRef} variant="ghost" size="icon">
        <DotsThree weight="bold" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </Button>
    </DropdownMenuTrigger>
  );
}

export function DeviceRowActions({ deviceId }: { deviceId: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openAfterMenuClose = useRef(false);

  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DropdownMenu>
        <ActionMenuTrigger label={`Actions for ${deviceId}`} triggerRef={triggerRef} />
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!openAfterMenuClose.current) return;
            event.preventDefault();
            openAfterMenuClose.current = false;
            setConfirmOpen(true);
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => { openAfterMenuClose.current = true; }} className="text-destructive focus:text-destructive">
              <Trash aria-hidden="true" />
              Remove access
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this Mac?</AlertDialogTitle>
          <AlertDialogDescription>It will need to sign in again before using Tab.</AlertDialogDescription>
        </AlertDialogHeader>
        <form method="post" action={`/dashboard/devices/${encodeURIComponent(deviceId)}/revoke`}>
          <input type="hidden" name="confirm" value={deviceId} />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive">Remove access</Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MemoryRowActions({ memory, label }: { memory: PersonalMemory; label: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openAfterMenuClose = useRef<"edit" | "delete" | null>(null);

  const returnFocusToTrigger = (event: Event) => {
    event.preventDefault();
    triggerRef.current?.focus();
  };

  return (
    <>
      <DropdownMenu>
        <ActionMenuTrigger label={label} triggerRef={triggerRef} />
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            const action = openAfterMenuClose.current;
            if (!action) return;
            event.preventDefault();
            openAfterMenuClose.current = null;
            if (action === "edit") setEditOpen(true);
            else setDeleteOpen(true);
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => { openAfterMenuClose.current = "edit"; }}>
              <NotePencil aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { openAfterMenuClose.current = "delete"; }} className="text-destructive focus:text-destructive">
              <Trash aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent onCloseAutoFocus={returnFocusToTrigger}>
          <DialogHeader>
            <DialogTitle>Edit memory</DialogTitle>
            <DialogDescription>Update the saved detail Tab can use in Suggestions.</DialogDescription>
          </DialogHeader>
          <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/edit`} className="grid gap-4">
            <Field>
              <FieldLabel htmlFor={`memory-${memory.id}-content`}>Memory content</FieldLabel>
              <Textarea
                id={`memory-${memory.id}-content`}
                name="content"
                maxLength={500}
                required
                rows={4}
                autoComplete="off"
                className="min-h-24"
                defaultValue={memory.content}
              />
            </Field>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
              <Button type="submit">Update Memory</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent onCloseAutoFocus={returnFocusToTrigger}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>This saved detail will be permanently removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <form method="post" action={`/dashboard/memories/${encodeURIComponent(memory.id)}/delete`}>
            <input type="hidden" name="confirm" value="delete-memory" />
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive">Delete Memory</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
