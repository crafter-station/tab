Issue 31 manual validation notes: Zed focused editor App Context

1. Zed markdown/prose file: open Zed with a markdown note or prose buffer, type near an existing paragraph, and observe the debug/request metadata showing `appContextProvider: "zed-focused-editor"`, `appContextStatus: "available"`, and a single suggestion-only fragment. Suggestions should follow nearby editor context without reading the file from disk.
2. Zed code/comment file: open a source file, type inside or immediately after a prose comment, and verify suggestions can use the surrounding focused editor context while preserving normal Text Session insertion behavior.
3. Fallback checks: when Zed Accessibility text is unavailable, unreliable, empty, or secret-like, App Context should be omitted or suppressed while existing Text Session and Typing Context behavior continues.
