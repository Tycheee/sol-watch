# Security Policy

## Supported version

Security fixes target the latest version on the default branch.

## Reporting a vulnerability

Please avoid posting sensitive details in a public GitHub issue.

For reproducible bugs, provide the minimum information necessary:

- Sol Watch version / commit
- Browser and version
- Relevant feature (timestamp display, send-time injection, metadata hiding, clipboard handling)
- A synthetic or redacted reproduction

Do **not** include:

- ChatGPT cookies or tokens
- Passwords
- Real private conversations
- Personal account identifiers
- Screenshots containing sensitive content unless fully redacted

If a report can be demonstrated safely with synthetic content, prefer that.

## Scope

Sol Watch runs only on the configured ChatGPT web origins and requests only the `storage` extension permission. It has no backend service and should not initiate external network requests.

Because Sol Watch interacts with the ChatGPT page DOM and send flow, upstream frontend changes can cause compatibility bugs. A compatibility failure is not automatically a security vulnerability, but issues that could expose, alter, or unintentionally send user content should be treated as security-sensitive.
