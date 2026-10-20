# Jess Ford fixed operations

Service desk for Jess Ford in Grand Coulee and Pullman. Advisors write repair orders, techs flag time, parts come off the shelf when a ticket is invoiced, and the office can see the month against Washington’s repair-authorization rules (RCW 46.71).

The shop calendar is Pacific Time. The screen shows today’s date, not a baked-in sample day. A fresh start has no customers or repair orders. Set `VITE_DEMO_MODE` before the app starts to load the sample month. Settings offers that load again only while demo mode is on. The office signs in as admin with a blank user name, or the user name `admin`, and the password `admin`.

Postgres, accounts, and the live DMS connection come later. Until then the shop lives in this browser.

## Run it

You need **Node.js 22** and **npm 11**. `npm ci` fails on npm 10 with this lockfile: npm reports that `ajv@6.15.0` does not satisfy `ajv@8.20.0` (and a few related packages). npm 11 installs the same lockfile. GitHub Actions installs npm 11 before `npm ci`. The Node 22 image on Actions still ships npm 10, so the workflow pins npm itself.

```sh
node -v   # v22.x
npm -v    # 11.x
npm ci
npm run dev
```

If `npm -v` prints 10, upgrade npm (`npm install -g npm@11`) and run `npm ci` again.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build, then database migrations when `DATABASE_URL` is set |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run preview` | Serve the production build |
| `npm run db:migrate` | Apply SQL migrations. Skips itself when `DATABASE_URL` is unset |

## Environment

Nothing here is required to run the desk locally. Only names that start with `VITE_` reach the browser.

| Variable | Used today |
| --- | --- |
| `VITE_DEMO_MODE` | Optional. `1`, `true`, `yes`, or `on` loads the sample month on a fresh browser. Off by default. A shop already saved in the browser keeps that copy. |
| `VITE_AUTH_ENABLED` | Optional in the Grok sandbox. `false` is the desk’s own sign-in. Outside the sandbox, `false` makes the auth server refuse to start. |
| `DATABASE_URL` | Unused by the desk. Migrations and the pre-wired auth server read it later. |
| `GROK_PROJECT_ID` | Set by the platform on a deployed app. When it is set, the process is not the Grok sandbox. |
| `VERCEL`, `VERCEL_ENV` | Set by Vercel. Either one means this is not the Grok sandbox, even without `GROK_PROJECT_ID`. |
| `GROK_AUTH_CLIENT_ID` | Per-app OAuth client id for the Grok auth broker. Required outside the sandbox. |
| `GROK_AUTH_CLIENT_SECRET` | Per-app OAuth client secret. Required outside the sandbox. The preview secret is never a fallback. |
| `GROK_AUTH_ISSUER` | Optional. Broker issuer. Defaults to `https://auth.grok.me`. |
| `GROK_PREVIEW_CLIENT_SECRET` | Grok sandbox only (`NODE_ENV=development`, and no `VERCEL`, `VERCEL_ENV`, or `GROK_PROJECT_ID`). Shared live-preview OAuth client secret for client id `grok_preview`. Ignored everywhere else. Never commit it. |
| `BETTER_AUTH_SECRET` | Required outside the sandbox. Signing secret for Better Auth. |
| `BETTER_AUTH_URL` | Required outside the sandbox. Public origin of this app. Sandbox hosts are not trusted when this is the only URL. |

## Deploy

The production build uses the Nitro Vercel preset. `npm run build` writes the server output and runs migrations only when `DATABASE_URL` is present. A Vercel project is not the Grok sandbox. The auth server there refuses to start until `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are set, and it will not accept `VITE_AUTH_ENABLED=false` or the preview client. Leave `GROK_PREVIEW_CLIENT_SECRET` off the production project.

Sample customers load only when `VITE_DEMO_MODE` is on. Settings then shows “Load sample month”. Clearing the shop or loading that sample keeps the current settings, including the admin password and the labor targets.
