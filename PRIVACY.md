# Privacy

LLM Test Bench is a mostly static website with no user accounts and no analytics. Its only server-side part is a small showcase service (Cloudflare Pages Functions with a D1 database and R2 storage) that holds the published showcase examples and stores nothing about visitors.

- Your working files, prompts, API keys, and generations never reach the showcase service.
- The maintainer edits the showcase from an admin page behind Cloudflare Access (an emailed one-time code). Visitors never sign in.

- Files are read from and written to a folder the user explicitly chooses through the browser's File System Access API.
- Provider credentials are stored in the browser and may also be stored in the suite settings inside the chosen data folder.
- Prompts, images, and settings are sent directly to the model provider selected by the user when a generation request is made.
- Screen recording uses the browser's own capture picker and saves or downloads the resulting file at the user's request.
- Hosting and CDN providers may retain ordinary request logs under their own policies.

Do not put sensitive information into prompts, generated samples, issues, screenshots, or recordings. See the hosted `privacy.html` page for the user-facing version of this policy.
