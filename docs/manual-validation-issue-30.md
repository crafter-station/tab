# Manual Validation: Issue 30 Obsidian App Context

## Ordinary Note

1. Open Obsidian and focus an ordinary markdown note with headings and list items near the cursor.
2. Type a short continuation in the active editor.
3. Confirm the debug context surface shows App Context provider `obsidian-accessibility-editor` with one suggestion-only fragment.
4. Confirm the fragment contains only nearby editor markdown context and preserves useful heading/list structure.
5. Confirm no vault files are opened or read from disk and no Full Disk Access prompt appears.

## Long Note

1. Open a long Obsidian note with older content far above and below the cursor.
2. Type near a current markdown section.
3. Confirm the App Context fragment is bounded to nearby editor context, not the whole note or vault.
4. Confirm the context includes the current section around the caret and omits unrelated distant sections.
5. Confirm the fragment remains suggestion-only and is not shown as Personal Memory eligible.
