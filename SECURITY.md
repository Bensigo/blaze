# Security

Do not post credentials, player/session records, private recordings or exploit details in a public issue. Contact the repository owner through a private GitHub security report when available. If private reporting is unavailable, request a private contact channel without including sensitive details.

Use distinct production credentials, minimal trusted origins, private media storage and server-derived workspace identity. Rotate leaked credentials immediately. Revoking an MCP token denies subsequent report requests; clients may retain reports already returned. MCP tokens expire after 90 days and grant aggregate read access to one workspace.

Analytics still depends on browser consent, instrumentation and delivery; it is not fraud detection. Player capture is off by default and requires separate explicit consent. Operators must configure scheduled capture cleanup, monitor failures and choose a policy for raw event retention, which is not automatically configured.
