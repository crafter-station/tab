# Tabb

Tabb is a native desktop autocomplete product that suggests continuations while a person types in other applications.

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
The recent text-bearing input Tabb uses to request a suggestion, excluding navigation, shortcuts, window switching, and other non-text actions.
_Avoid_: Raw keystroke log, full document scrape

**Floating Suggestion Overlay**:
A semitransparent desktop overlay that displays the current suggestion while the active application continues receiving typing input.
_Avoid_: Web popup, tooltip below the app

**Personal Memory**:
A durable backend-stored fact or preference used to make suggestions feel personal, visible to and controllable by the user.
_Avoid_: Raw typing log, hidden profile
