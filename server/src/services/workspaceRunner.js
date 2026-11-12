import http from 'node:http';
import https from 'node:https';

const configured = () => Boolean(process.env.WORKSPACE_RUNNER_URL && process.env.WORKSPACE_RUNNER_TOKEN);

export function workspaceRunnerConfigured() {
  return configured();
}

export async function callWorkspaceRunner(path, { method = 'POST', body, timeoutMs = 10_000 } = {}) {
  if (!configured()) {
    const error = new Error('Isolated workspace runner is not configured.');
    error.status = 503;
    throw error;
  }
  const base = process.env.WORKSPACE_RUNNER_URL.replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.WORKSPACE_RUNNER_TOKEN}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error(`Could not reach the isolated workspace runner: ${cause.message}`);
    error.status = 502;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Workspace runner returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload.data ?? payload;
}

export function proxyWorkspaceRunnerRequest(path, request, response) {
  if (!configured()) {
    response.status(503).json({ success: false, message: 'Isolated workspace runner is not configured.' });
    return;
  }
  const base = new URL(process.env.WORKSPACE_RUNNER_URL);
  const transport = base.protocol === 'https:' ? https : http;
  const headers = { ...request.headers, host: base.host };
  for (const header of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'cookie', 'authorization']) delete headers[header];
  headers.authorization = `Bearer ${process.env.WORKSPACE_RUNNER_TOKEN}`;
  let body;
  if (request.body !== undefined && !['GET', 'HEAD'].includes(request.method)) {
    if (String(request.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) body = Buffer.from(new URLSearchParams(request.body).toString());
    else { body = Buffer.from(JSON.stringify(request.body)); headers['content-type'] = 'application/json'; }
    headers['content-length'] = String(body.length);
  }
  const upstream = transport.request({ protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method: request.method, path: `${base.pathname.replace(/\/$/, '')}${path}`, headers }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    for (const header of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'set-cookie']) delete responseHeaders[header];
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.setTimeout(30_000, () => upstream.destroy(new Error('The forwarded port timed out.')));
  upstream.on('error', (error) => {
    if (!response.headersSent) response.status(502).json({ success: false, message: `Port forwarding failed: ${error.message}` });
    else response.destroy(error);
  });
  if (body) upstream.end(body);
  else if (request.body !== undefined || ['GET', 'HEAD'].includes(request.method)) upstream.end();
  else request.pipe(upstream);
}
export async function deleteRunnerWorkspace(workspaceId) {
  if (!configured()) return { configured: false };
  return callWorkspaceRunner(`/v1/workspaces/${workspaceId}`, { method: 'DELETE', timeoutMs: 35_000 });
}
export async function syncRunnerFile(workspaceId, path, content) {
  if (!configured()) return { configured: false };
  return callWorkspaceRunner(`/v1/workspaces/${workspaceId}/files`, { method: 'PUT', body: { path, content }, timeoutMs: 15_000 });
}

export async function deleteRunnerFile(workspaceId, path) {
  if (!configured()) return { configured: false };
  return callWorkspaceRunner(`/v1/workspaces/${workspaceId}/files`, { method: 'DELETE', body: { path }, timeoutMs: 15_000 });
}

export async function syncRunnerWorkspace(workspaceId, files, directories = []) {
  if (!configured()) return { configured: false };
  return callWorkspaceRunner('/v1/workspaces/' + workspaceId + '/files/sync', { body: { files, directories }, timeoutMs: 90_000 });
}

export async function workspaceRunnerHealth() {
  if (!configured()) return { configured: false, online: false };
  try {
    const data = await callWorkspaceRunner('/v1/health', { method: 'GET', timeoutMs: 2_500 });
    return { configured: true, online: true, ...data };
  } catch (error) {
    return { configured: true, online: false, message: error.message };
  }
}
