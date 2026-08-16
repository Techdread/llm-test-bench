# Deploying your own copy

This project is a plain static site: HTML, CSS, and native ES modules with no
build step and no server. Any static host will serve it, and the whole repository
is the deploy artefact.

## Run it locally

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080` in Chrome or Edge. Do not open the files with a
`file://` URL — ES modules and folder access need an HTTP(S) origin.

## Deploy to a static host

Fork or clone the repository, then point your host at it with:

- **Build command:** none (`exit 0` if a command is required)
- **Build output directory:** `.` (the repository root)
- **Framework preset:** none

That is the whole configuration. Cloudflare Pages, Netlify, GitHub Pages, and
Vercel all work; the notes below use Cloudflare Pages because `_headers` is
written in its format.

### Cloudflare Pages

1. In the Cloudflare dashboard, open **Workers & Pages**.
2. Choose **Create application → Pages → Connect to Git** and select your fork.
3. Set the production branch, use no framework preset, set the build command to
   `exit 0`, and set the output directory to `.`.
4. Save and deploy.

You get a `*.pages.dev` address immediately. Test it before attaching a custom
domain; to add one, use the Pages project's **Custom domains** screen rather than
creating a DNS record by hand, or you may see a `522` error.

- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
- https://developers.cloudflare.com/pages/configuration/custom-domains/

### Other hosts

`_headers` is Cloudflare-specific. On Netlify the same file format works; on other
hosts, port the equivalent rules — `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `X-Frame-Options`, and long-lived immutable caching for
`/shared/lib/*` — to your host's own configuration.

## Requirements

Serve over HTTPS (or `localhost`). The File System Access API, local-network
access to a model server, and screen recording are all secure-context features
and will not work over plain HTTP on a remote origin.

No environment variables or deployment secrets are needed. Provider API keys are
entered by each user in their own browser and are never part of the deployment.

## Check the deployment

- The landing page, settings page, privacy page, and all three tools load.
- The site still works with the network offline after first load — every runtime
  dependency is vendored under `shared/lib/`, so nothing should be fetched from a
  CDN.
- The header navigation is reachable on a narrow phone-width viewport.
- Connecting a folder, generating, saving, reloading, and comparing all work in
  Chrome or Edge.
- No API key appears anywhere in the repository or your host's settings.
