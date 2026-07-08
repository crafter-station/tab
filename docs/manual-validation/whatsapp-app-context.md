# WhatsApp App Context Manual Validation

Validate on macOS with Accessibility and Input Monitoring granted. Do not grant Screen Recording.

1. Open WhatsApp and focus a direct-message chat with at least two visible messages.
2. Type a short reply draft and wait for the debug overlay.
3. Confirm the overlay shows `App Context` with provider `whatsapp-conversation`, `available` status, confidence, one fragment, and a bounded message count.
4. Confirm the suggestion fits the visible recent conversation and that Typing Context remains the typed draft only.
5. Open a group or multi-speaker chat with recent visible messages from at least two speakers.
6. Type a short reply draft and confirm provider metadata is still shown, the message count remains bounded, and the suggestion reflects recent speakers without exposing old chat history.
7. Switch to a non-WhatsApp app and confirm App Context is absent or unsupported while ordinary Typing Context suggestions continue.
8. Revoke Accessibility or run without it and confirm WhatsApp App Context is empty and suggestions fail back to Typing Context only.

Notes for the next real-app pass: record the WhatsApp version, whether direct-message heading extraction was available, whether group speaker names were exposed, and any malformed Accessibility descriptions that were suppressed.
