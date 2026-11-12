# Local isolated workspace runner

This runner exposes the API expected by DEVCOLLAB and runs workspace commands in resource-limited Docker containers. It binds only to 127.0.0.1 and reads its bearer token from server/.env.

## Start locally

1. Start Docker Desktop and wait until its engine is running.
2. Make sure server/.env contains the local runner URL and token, and set WORKSPACE_RUNNER_NETWORK=bridge for port forwarding.
3. Restart the API with npm run dev:server so it loads the runner URL and token.
4. From the repository root, start npm run dev:runner.
5. Refresh the workspace page. The terminal status should say Runner connected.

The runner stores per-workspace files under runner/workspaces/, which is ignored by Git. It keeps a persistent runtime container for each workspace environment so each terminal can preserve its own working directory and background servers can continue running. Containers mount only the workspace folder and have CPU, memory, process, and command time limits. They do not receive the Docker socket or host networking.

## Forward a port

1. Start the app from the terminal, binding it to 0.0.0.0. For example, use `npm run dev -- --host 0.0.0.0 &>/tmp/devcollab-app.log 2>&1 &` in Bash, or start it with PowerShell `Start-Process` and redirect its output.
2. Open the Ports tab, enter the app's port (1024–65535), and select Forward Port.
3. Select Open beside the forwarded port.

Up to 20 ports can be forwarded per workspace. Forwarding uses an authenticated HTTP proxy; common root-relative paths in HTML, CSS, and JavaScript are rewritten for the proxy path. WebSocket upgrades are not forwarded, so dev-server hot reload may not work. Use WORKSPACE_RUNNER_NETWORK=bridge; `none` disables port forwarding. Forwarded ports and runtime containers are removed when the project is deleted.

The local runner supports terminal commands, file sync, and HTTP port forwarding. Git operations still require a separate runner implementation. Do not expose the local runner port to the public internet. A deployed DEVCOLLAB API needs a separate private runner host; 127.0.0.1 refers to the API host itself after deployment.