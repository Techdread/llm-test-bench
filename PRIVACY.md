# Privacy

LLM Test Bench is a static website with no application accounts, analytics, or hosted project database in the initial release.

- Files are read from and written to a folder the user explicitly chooses through the browser's File System Access API.
- Provider credentials are stored in the browser and may also be stored in the suite settings inside the chosen data folder.
- Prompts, images, and settings are sent directly to the model provider selected by the user when a generation request is made.
- Screen recording uses the browser's own capture picker and saves or downloads the resulting file at the user's request.
- Hosting and CDN providers may retain ordinary request logs under their own policies.

Do not put sensitive information into prompts, generated samples, issues, screenshots, or recordings. See the hosted `privacy.html` page for the user-facing version of this policy.
