# Deploying the static site

The recommended setup is GitHub plus Cloudflare Pages. Keep the first deployment on Cloudflare's generated `pages.dev` address until it has been tested, then add the custom subdomain.

## 1. Create the GitHub repository

Create a new empty public repository, for example `llm-test-bench`. Do not initialise it with a README, licence, or `.gitignore`, because those files are already present here.

From this clean release directory:

```bash
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-ACCOUNT/llm-test-bench.git
git push -u origin main
```

Before pushing, search the staged files for secrets and personal paths and inspect `git status` one last time.

## 2. Connect Cloudflare Pages

In the Cloudflare dashboard:

1. Open **Workers & Pages**.
2. Choose **Create application → Pages → Connect to Git**.
3. Authorise GitHub for this repository and select it.
4. Set the production branch to `main`.
5. Use no framework preset.
6. Set the build command to `exit 0` and the build output directory to `.`.
7. Save and deploy.

Cloudflare will provide an address such as `llm-test-bench.pages.dev`. Test all three apps there before changing DNS. Future pushes to `main` deploy automatically, while pull-request branches receive preview deployments.

Official references:

- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- https://developers.cloudflare.com/pages/get-started/git-integration/

## 3. Add the preview domain

Use `testbench.neuroviz.uk` for the first custom-domain test rather than replacing anything already served from `neuroviz.uk`.

1. Open the Pages project in Cloudflare.
2. Go to **Custom domains → Set up a domain**.
3. Enter `testbench.neuroviz.uk` and continue.
4. Because the domain is already managed by Cloudflare, confirm the DNS record Cloudflare proposes.
5. Wait for the domain and certificate to become active, then repeat the browser checks.

Start this process from the Pages project's **Custom domains** screen. Do not manually create a Pages CNAME first; Cloudflare warns that skipping the Pages association can produce a `522` error.

Official reference: https://developers.cloudflare.com/pages/configuration/custom-domains/

## 4. Launch checklist

- Landing page, privacy page, and all three tools load over HTTPS.
- Prompt counts are 62, 24, and 55.
- Folder connection, generation, streaming, save, reload, compare, export, and recording are tested.
- Code Morph/Bugfix actions and CLI-agent choices are absent in hosted mode.
- No real API key appears in the repository, deployment variables, screenshots, or browser recordings.
- The GitHub repository link on the landing page points to the final repository.
- GitHub Issues, private vulnerability reporting, and branch protection are configured.
- A tagged `v0.1.0` release is created only after the preview is approved.
