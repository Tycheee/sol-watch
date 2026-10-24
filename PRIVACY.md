# Privacy

Sol Watch is a local browser extension for the ChatGPT desktop web interface.

## What it accesses

- The rendered ChatGPT page and message metadata needed to read `create_time`.
- The current composer text when Sol Watch needs to prepend a time metadata line.
- `chrome.storage.local` for extension settings.

## What it does not do

- No backend server.
- No analytics, telemetry, ads, or tracking.
- No external `fetch` / XHR requests initiated by Sol Watch.
- No collection or upload of chat content.
- No reading of account cookies, passwords, auth tokens, or unrelated browsing data.

## Important behavior

When send-time injection is enabled, Sol Watch adds a real metadata line to the message before it is sent, for example:

```text
⟦t=2026-10-24T12:34:56+08:00⟧
Your message...
```

That line becomes part of the message content stored by ChatGPT. Sol Watch can hide it in the desktop web UI, but it cannot hide it in other clients where the extension is not installed, including mobile apps.

## Local settings

Settings are stored in `chrome.storage.local`. Session-anchor timing state is kept in page memory and is reset when the page is refreshed.

## Reporting privacy issues

Please do not paste real conversations, cookies, tokens, account identifiers, or other sensitive data into public issues. See `SECURITY.md` for reporting guidance.
