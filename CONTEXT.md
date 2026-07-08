# Tab

Tab is a native desktop autocomplete product that suggests continuations while a person types in other applications.

## Language

**Native Autocomplete App**:
A desktop application that observes typing context outside its own window and offers suggested continuation text for the active application.
_Avoid_: Web app, browser autocomplete

**Suggestion**:
Candidate continuation text generated from the user's current typing context.
_Avoid_: Prediction, completion

**Acceptance**:
The user's deliberate action to insert a suggestion into the active application.
_Avoid_: Submit, select

**Active Application**:
The macOS application currently receiving the user's typing input.
_Avoid_: Browser tab, page, client app

**Typing Context**:
The recent text-bearing input Tab uses to request a suggestion, excluding navigation, shortcuts, window switching, and other non-text actions.
_Avoid_: Raw keystroke log, full document scrape

**Floating Suggestion Overlay**:
A semitransparent desktop overlay that displays the current suggestion while the active application continues receiving typing input.
_Avoid_: Web popup, tooltip below the app

**Personal Memory**:
A durable backend-stored fact learned from the user's own typing and used to make suggestions feel personal, visible to and controllable by the user. Personal Memory is unstructured memory, not a typed profile schema or categorized record for specific fields like company, phone, or email.
_Avoid_: Raw typing log, hidden profile, autofill profile

**Memory Authorship**:
Whether a Personal Memory was explicitly created by the user or created by Tab's background learning system.
_Avoid_: Source, category, sensitivity

**Memory Extraction Window**:
A recent, temporary span of user-authored typing context stored by the desktop and considered together when deciding which Personal Memory records to create, update, or hard delete. The window is bounded by both elapsed time and retained context size.
_Avoid_: Keystroke log, full history, profile sync

**Memory Extraction**:
The background process that turns a Memory Extraction Window into create, update, or hard-delete operations for system-created Personal Memory.
_Avoid_: Suggestion request, profile sync, log upload

**Plan Change**:
A user-initiated move from one billing plan to another while preserving the same billing customer and subscription relationship.
_Avoid_: New checkout, second subscription
