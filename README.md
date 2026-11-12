# DEVCOLLAB

DEVCOLLAB is a full-stack developer collaboration workspace built with React, Vite, Express, MongoDB, and Socket.IO. Developers can discover projects, form teams, manage a Kanban board, chat, share code, and take part in a technical community.

## Features

- Account registration, login, logout, password reset, and role-protected admin access
- Developer profiles, searchable directory, skills, social links, GitHub profile import, and optional Cloudinary avatars
- Public and private projects, skill and technology filters, GitHub repository metadata, join requests, invitations, and team roles
- Project tasks with assignees, priorities, deadlines, status filters, and completion progress
- Persisted one-to-one and project room chat with live presence and unread alerts
- Private or public code snippets with syntax highlighting, tags, copy, and shareable links
- Searchable community discussions with tags, likes, replies, and content reporting
- Persisted notifications, dashboard activity, and administrative moderation tools
- Light and dark themes, responsive layouts, and loading, empty, and error states

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer
- MongoDB locally or a MongoDB Atlas connection string
- Docker Desktop for the local isolated terminal runner

## Local setup

From the repository root:

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI`. Create a strong `JWT_SECRET`; for example, in PowerShell:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

3. Start the API and client in separate terminals:

   ```sh
   npm run dev:server
   npm run dev:client
   ```

4. Open the Vite URL (normally `http://localhost:5173`). The API health endpoint is `http://localhost:5000/api/health`.
5. To use the workspace terminal locally, start Docker Desktop, then run npm run dev:runner in a third terminal from the repository root. Restart the API after the first runner configuration is added to server/.env.

The API can start before MongoDB is configured so the interface can be previewed. Database-backed API routes return `503` until `MONGODB_URI` connects successfully.

## Environment variables

Set these in `server/.env`:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production` for deployment. |
| `PORT` | API port; defaults to `5000`. |
| `CLIENT_ORIGIN` | Frontend origin, or comma-separated origins. |
| `MONGODB_URI` | MongoDB connection string. |
| `JWT_SECRET` | Long, private signing key; required in production. |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend HTTP API key and verified sender for reset emails. |
| `SMTP_URL` | Optional SMTP connection if the hosting provider permits outbound SMTP. |
| `CLOUDINARY_URL` or `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary credentials for avatar uploads. |
| `GITHUB_TOKEN` | Optional token for higher GitHub API rate limits. |
| `WORKSPACE_RUNNER_URL`, `WORKSPACE_RUNNER_TOKEN` | Optional private isolated runner endpoint and bearer token. Without these, files and collaboration work, while code execution, previews, port forwarding, and runner based Git actions remain disabled. |
| `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_FULL_NAME`, `ADMIN_PASSWORD` | Admin account seed values. The password must be at least 8 characters and no more than 72 UTF-8 bytes. |

The project includes no service credentials. Avatar upload and reset email delivery remain unavailable until their respective provider settings are configured. In development, password reset returns a short-lived reset token in the UI. New passwords require at least 8 characters and are limited to 72 UTF-8 bytes to match bcrypt's input limit.

## Project workspaces

Every new project receives a workspace automatically. Existing projects receive one the first time a member opens it. Text files are stored in MongoDB so they persist with the database; each workspace is limited to 2,000 files, 1 MB per file, and 50 MB total. Yjs updates are synchronized over the authenticated Socket.IO connection, while the REST file routes support offline saves and file search.

The IDE includes Monaco editing, project chat, linked tasks, activity, team presence, role based editor/viewer access, language profiles for Node.js, Python, Java, Go, Rust, C/C++, PHP, Ruby, .NET, Kotlin, Swift, Dart, Elixir, Haskell, Lua, Perl, R, Scala, Clojure, and shell, plus terminal, Git, preview, and port forwarding controls. Execution calls a separate runner; the main web API never executes workspace commands on its host.

### Local terminal runner

The repository includes runner/src/server.js. It listens on 127.0.0.1 only, reads a private token from server/.env, and stores workspace snapshots under runner/workspaces/. Start Docker Desktop, restart the API, then run npm run dev:runner from the repository root.

The runner keeps a resource-limited Docker runtime for each workspace environment so terminal working directories persist and background servers can continue running. Containers mount only the workspace folder; they do not receive the Docker socket or host networking. WORKSPACE_RUNNER_NETWORK=bridge allows package installs and is required for port forwarding; set it to none to disable container network access and port forwarding. The local runner supports terminal commands, file sync, and HTTP port forwarding. Local runner Git operations remain unavailable.

To preview a web app, start its server bound to 0.0.0.0, open the Ports tab, enter its port (1024–65535), select Forward Port, and use Open. A workspace can forward up to 20 ports. Requests go through an authenticated API proxy that rewrites common root-relative HTML, CSS, and JavaScript paths. WebSocket upgrades are not forwarded, so development-server hot reload may need separate configuration. Project deletion removes its runner containers.

For a public deployment, do not set the deployed API runner URL to a developer's localhost. Deploy a dedicated runner on a separate Linux host and configure WORKSPACE_RUNNER_URL and a private WORKSPACE_RUNNER_TOKEN in the API environment. A normal Render Node service should not execute workspace commands itself. A remote runner must implement these bearer authenticated routes:

- GET /v1/health — report runner availability and terminal/port capabilities.
- PUT /v1/workspaces/:id/files and DELETE /v1/workspaces/:id/files — sync individual files.
- POST /v1/workspaces/:id/files/sync — replace/sync the workspace file snapshot before execution.
- POST /v1/workspaces/:id/exec — run { command, profile, terminalType, cwd, userId }, return { stdout, stderr, exitCode, cwd }.
- POST /v1/workspaces/:id/ports and DELETE /v1/workspaces/:id/ports/:port — create and remove forwarding relays.
- Stream HTTP requests for /v1/workspaces/:id/ports/:port/proxy/* to the selected workspace port.
- POST /v1/workspaces/:id/git — handle status, diff, commit, pull, push, or branches when runner based Git is enabled.
- DELETE /v1/workspaces/:id — remove the workspace snapshot, runtime containers, and port relays.

## Admin account

Set `MONGODB_URI` and the four `ADMIN_*` values in `server/.env`, then run:

```sh
npm run seed:admin
```

The script creates the admin account if it does not exist. If the email already belongs to an account, it promotes that account and keeps its existing password.

## Scripts

- `npm run dev:client` — start Vite with API and Socket.IO development proxies
- `npm run dev:server` — start the API with Node watch mode
- `npm run build` — build the production frontend into `client/dist`
- `npm start` — start the API
- `npm run seed:admin` — create or promote the configured admin account

## Deploy on Render

The `render.yaml` Blueprint runs the production app as one Node web service: Express serves the built React app, API, and Socket.IO from one origin. `NODE_ENV=production` is set explicitly, and the Blueprint creates a private JWT secret.

1. Create a private GitHub repository for this project and push the project files once. Keep `.env` and `runner/workspaces/` out of Git; `.gitignore` already excludes them.
2. In Render, create a Blueprint from that repository and choose the Free web service. Set `MONGODB_URI` to a MongoDB Atlas connection string. Leave the generated `JWT_SECRET` alone. `RESEND_API_KEY` and `MAIL_FROM` are optional; add them if you want password-reset emails.
3. After the first deploy, Render gives the site a public `onrender.com` URL. You can open it on other devices. The service starts in Render's cloud, so your PC and local development commands do not need to stay running. Render redeploys when you push later changes to GitHub.

The free service has an always-reusable URL, but it is not continuously awake: Render spins it down after 15 minutes without inbound traffic and waking it can take about a minute. Render's documentation positions Free instances for testing and hobby projects, not production. A truly always-on service requires paid compute. MongoDB Atlas Free clusters have a 512 MB storage limit.

This Blueprint deploys the website and API, but not the isolated workspace runner. Cloud terminals and port forwarding require a separate Linux host with Docker; the free Render Node service does not provide that runner. The rest of the deployed app remains usable without it. Do not point a public deployment at a developer's localhost.

For custom domains, set `CLIENT_ORIGIN` and `PUBLIC_APP_URL` to the final HTTPS origin. Resend requires a verified sender domain for production password-reset emails.


## Structure

```text
client/  React application, pages, contexts, API client, and Vite configuration
server/  Express API, Mongoose models, routes, auth, Socket.IO, and integrations
```

