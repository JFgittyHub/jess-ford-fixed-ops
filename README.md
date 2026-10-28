# Jess Ford fixed operations

Service desk for Jess Ford in Grand Coulee and Pullman. Advisors write repair orders, techs flag time, parts come off the shelf when a ticket is invoiced, and the office can see the month against Washington’s repair-authorization rules (RCW 46.71).

Module titles stay Scheduling, Customer Messaging, Inspections, and Service Marketing. Do not use third-party Schedule, Engage, Inspect, or Invite product labels.

The shop calendar is Pacific Time. The screen shows today’s date, not a baked-in sample day. There is no in-app password. The desk opens only when demo mode is explicitly on: `VITE_DEMO_MODE` is the exact text `1` or `true`, and the data in memory is the sample month. A fresh start with that flag loads the sample month, and the staff picker, settings, and the rest of the desk are open. Edits during that visit stay in memory. Reloading brings the sample month back, and demo mode writes nothing to the browser’s saved shop. A sample month saved by an older visit is discarded. A real shop saved earlier is left in place and is not opened by the demo. A missing or unreadable flag, any other value, a real shop, or a development server by itself leaves the desk locked. The screen then says sign-in via Azure/Entra is coming, and demo mode is the only way in for now. Settings can reload the sample month, and asks before that replaces customers, tickets, or a roster. Clearing the shop or loading the sample keeps the current store name and labor targets.

This desk is a standalone platform. A DMS adapter is optional, and the shop runs without one. Outside demo mode the shop is saved in this browser. Demo mode is not.

## Run it

You need **Node.js 22** and **npm 11**. `npm ci` fails on npm 10 with this lockfile: npm reports that `ajv@6.15.0` does not satisfy `ajv@8.20.0` (and a few related packages). npm 11 installs the same lockfile. GitHub Actions installs npm 11.21.1 before `npm ci`. The Node 22 image on Actions still ships npm 10, so the workflow pins that exact npm version.

```sh
node -v   # v22.x
npm -v    # 11.x
npm ci
npm run dev
```

If `npm -v` prints 10, upgrade npm (`npm install -g npm@11.21.1`) and run `npm ci` again.

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
| `VITE_DEMO_MODE` | Optional. The exact text `1` or `true` (spaces around it are ignored) opens the whole desk on the sample month, with no password. `yes`, `on`, `TRUE`, and every other value stay off. Edits last for the visit and are not saved. A missing flag or a real shop leaves the desk locked. Off by default. |
| `VITE_AUTH_ENABLED` | Optional in the Grok sandbox. `false` is the desk’s own sign-in. Outside the sandbox, `false` makes the auth server refuse to start. |
| `DATABASE_URL` | Unused by the desk. Migrations and the pre-wired auth server read it later. |
| `GROK_PROJECT_ID` | Set by the platform on a deployed app. When it is set, the process is not the Grok sandbox. |
| `VERCEL`, `VERCEL_ENV` | Set by Vercel. Either one means this is not the Grok sandbox, even without `GROK_PROJECT_ID`. |
| `GROK_AUTH_CLIENT_ID` | Per-app OAuth client id for the Grok auth broker. Required outside the sandbox. |
| `GROK_AUTH_CLIENT_SECRET` | Per-app OAuth client secret. Required outside the sandbox. The preview secret is never a fallback. |
| `GROK_AUTH_ISSUER` | Optional. Broker issuer. Defaults to `https://auth.grok.me`. |
| `GROK_PREVIEW_HOST`, `GROK_SANDBOX_HOST` | Positive sandbox marker the platform sets in the environment. One of them must be a live-preview host (`*.grok-sandbox.com`, `preview.grok.mil`, `preview.grok.genai.mil`, or `preview.grokgsac.com`). A request header cannot set it. `npm run dev` without the marker is not the sandbox. |
| `BETTER_AUTH_SECRET` | Required outside the sandbox. Signing secret for Better Auth. |
| `GROK_PREVIEW_CLIENT_SECRET` | Grok sandbox only, and only after the preview host above is set. Shared live-preview OAuth client secret for client id `grok_preview`. Ignored everywhere else. Never commit it. |
| `BETTER_AUTH_URL` | Required outside the sandbox. Public origin of this app. Sandbox hosts are not trusted when this is the only URL. |

## Deploy

The production build uses the Nitro Vercel preset. `npm run build` writes the server output and runs migrations only when `DATABASE_URL` is present. A Vercel project is not the Grok sandbox. When that server boots, `server/plugins/auth-guard.ts` refuses to start until `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` are set, and it will not accept `VITE_AUTH_ENABLED=false` or the preview client. A demo deploy needs those same per-app auth variables or the server will not boot. `VITE_DEMO_MODE` does not replace them. Leave `GROK_PREVIEW_CLIENT_SECRET` off the production project.

Sample customers load only when `VITE_DEMO_MODE` is on. The open desk then shows “Load sample month”. Clearing the shop or loading that sample keeps the current store name and labor targets. If the shop already has customers, tickets, or a roster, the second click has to confirm before the sample month replaces that work.
