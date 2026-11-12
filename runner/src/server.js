import dotenv from 'dotenv';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

const host = process.env.WORKSPACE_RUNNER_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.WORKSPACE_RUNNER_PORT || '5051', 10);
const token = process.env.WORKSPACE_RUNNER_TOKEN || '';
const root = path.resolve(process.cwd(), process.env.WORKSPACE_RUNNER_ROOT || 'runner/workspaces');
const dockerBin = process.env.WORKSPACE_RUNNER_DOCKER_BIN || 'docker';
const network = ['none', 'bridge'].includes(process.env.WORKSPACE_RUNNER_NETWORK) ? process.env.WORKSPACE_RUNNER_NETWORK : 'bridge';
const maxJsonBytes = 110 * 1024 * 1024;
const maxFileBytes = 1_048_576;
const maxFiles = 2_000;
const maxDirectories = 2_000;
const ignoredDirectories = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', 'venv', '__pycache__', 'target', '.gradle', '.cache', '.pytest_cache']);
const profiles = {
  node: { image: 'node:22-bookworm-slim', shell: '/bin/sh' },
  python: { image: 'python:3.13-slim', shell: '/bin/sh' },
  java: { image: 'eclipse-temurin:21-jdk', shell: '/bin/sh' },
  go: { image: 'golang:1.25-bookworm', shell: '/bin/sh' },
  rust: { image: 'rust:1.90-slim', shell: '/bin/sh' },
  cpp: { image: 'gcc:15', shell: '/bin/sh' },
  php: { image: 'php:8.4-cli', shell: '/bin/sh' },
  ruby: { image: 'ruby:3.4-slim', shell: '/bin/sh' },
  dotnet: { image: 'mcr.microsoft.com/dotnet/sdk:10.0', shell: '/bin/sh' },
  kotlin: { image: 'gradle:9-jdk21', shell: '/bin/sh' },
  swift: { image: 'swift:6.2', shell: '/bin/sh' },
  dart: { image: 'dart:stable', shell: '/bin/sh' },
  elixir: { image: 'elixir:1.19', shell: '/bin/sh' },
  haskell: { image: 'haskell:9.12', shell: '/bin/sh' },
  lua: { image: 'lua:5.4', shell: '/bin/sh' },
  perl: { image: 'perl:5.42', shell: '/bin/sh' },
  r: { image: 'r-base:4.5.2', shell: '/bin/sh' },
  scala: { image: 'scala:3.7.2', shell: '/bin/sh' },
  clojure: { image: 'clojure:1.12-tools-deps', shell: '/bin/sh' },
  bash: { image: 'bash:5.2', shell: '/bin/bash' },
};
const terminalProfiles = {
  bash: { image: 'bash:5.2', shell: '/bin/bash', kind: 'posix' },
  ubuntu: { image: 'ubuntu:24.04', shell: '/bin/bash', kind: 'posix' },
  git: { image: 'alpine/git:v2.54.0', shell: '/bin/sh', kind: 'posix' },
  powershell: { image: 'mcr.microsoft.com/dotnet/sdk:10.0', shell: 'pwsh', kind: 'powershell' },
};

function sendJson(res, status, body) {
  const content = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': content.length, 'Cache-Control': 'no-store' });
  res.end(content);
}

function authorized(req) {
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return Boolean(token && suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxJsonBytes) {
        failed = true;
        const error = new Error('Request body is too large.');
        error.status = 413;
        reject(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function validateWorkspaceId(value) {
  if (!/^[a-f\d]{24}$/i.test(value)) throw Object.assign(new Error('Invalid workspace id.'), { status: 422 });
  return value;
}

function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.includes('\0') || value.startsWith('/')) {
    throw Object.assign(new Error('Choose a valid workspace path.'), { status: 422 });
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 100)) {
    throw Object.assign(new Error('Choose a valid workspace path.'), { status: 422 });
  }
  return segments.join('/');
}

function validateWorkspaceCwd(value) {
  if (value === undefined || value === '') return '';
  return validateRelativePath(value);
}

function workspaceDirectory(workspaceId) {
  return path.join(root, validateWorkspaceId(workspaceId));
}

function resolveWorkspacePath(workspaceId, relativePath) {
  const normalized = validateRelativePath(relativePath);
  const base = workspaceDirectory(workspaceId);
  const fullPath = path.resolve(base, ...normalized.split('/'));
  if (fullPath !== base && !fullPath.startsWith(base + path.sep)) {
    throw Object.assign(new Error('Workspace path is outside its directory.'), { status: 422 });
  }
  return fullPath;
}

async function ensureSafeDirectory(workspaceId, relativePath = '') {
  const base = workspaceDirectory(workspaceId);
  await mkdir(base, { recursive: true });
  let current = base;
  for (const segment of relativePath.split('/').filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        await rm(current, { recursive: true, force: true });
        await mkdir(current);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(current);
    }
  }
  return current;
}

async function writeWorkspaceFile(workspaceId, relativePath, content) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > maxFileBytes) {
    throw Object.assign(new Error('Workspace files cannot exceed 1 MB.'), { status: 413 });
  }
  const normalized = validateRelativePath(relativePath);
  const parts = normalized.split('/');
  const fileName = parts.pop();
  const parent = await ensureSafeDirectory(workspaceId, parts.join('/'));
  const destination = path.join(parent, fileName);
  try {
    const stats = await lstat(destination);
    if (stats.isSymbolicLink()) await unlink(destination);
    else if (!stats.isFile()) throw Object.assign(new Error('A workspace folder already uses this file path.'), { status: 409 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(destination, content, { encoding: 'utf8', mode: 0o600 });
}

async function removeWorkspaceFile(workspaceId, relativePath) {
  const normalized = validateRelativePath(relativePath);
  const parts = normalized.split('/');
  const fileName = parts.pop();
  let parent = workspaceDirectory(workspaceId);
  for (const segment of parts) {
    parent = path.join(parent, segment);
    try {
      const parentStats = await lstat(parent);
      if (parentStats.isSymbolicLink()) throw Object.assign(new Error('Workspace symlink paths are not allowed.'), { status: 409 });
      if (!parentStats.isDirectory()) return;
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
  const destination = resolveWorkspacePath(workspaceId, normalized);
  try {
    const stats = await lstat(destination);
    if (stats.isSymbolicLink() || stats.isFile()) await unlink(destination);
    else throw Object.assign(new Error('A workspace file path points to a directory.'), { status: 409 });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function scanWorkspace(workspaceId) {
  const base = workspaceDirectory(workspaceId);
  await mkdir(base, { recursive: true });
  const files = new Map();
  const directories = [];
  const unsupported = new Set();

  async function walk(folder, relativeFolder) {
    const entries = await readdir(folder, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const entry of entries) {
      const relativePath = relativeFolder ? relativeFolder + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) { unsupported.add(relativePath); continue; }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        if (directories.length < maxDirectories) directories.push(relativePath);
        await walk(path.join(folder, entry.name), relativePath);
      } else if (entry.isFile()) {
        try {
          const stats = await lstat(path.join(folder, entry.name));
          if (stats.size > maxFileBytes) { unsupported.add(relativePath); continue; }
          const buffer = await readFile(path.join(folder, entry.name));
          if (buffer.includes(0)) { unsupported.add(relativePath); continue; }
          files.set(relativePath, buffer.toString('utf8'));
        } catch { unsupported.add(relativePath); }
      }
    }
  }

  await walk(base, '');
  return { files, directories: directories.sort(), unsupported };
}

async function syncWorkspace(workspaceId, files, directories = []) {
  if (!Array.isArray(files) || files.length > maxFiles || !Array.isArray(directories) || directories.length > maxDirectories) {
    throw Object.assign(new Error('Workspace snapshot exceeds the file or folder limit.'), { status: 413 });
  }
  const id = validateWorkspaceId(workspaceId);
  await mkdir(workspaceDirectory(id), { recursive: true });
  const desired = new Set();
  for (const file of files) {
    const relativePath = validateRelativePath(file?.path);
    if (typeof file?.content !== 'string' || Buffer.byteLength(file.content, 'utf8') > maxFileBytes) continue;
    desired.add(relativePath);
  }
  const current = await scanWorkspace(id);
  for (const existingPath of current.files.keys()) {
    if (!desired.has(existingPath)) await removeWorkspaceFile(id, existingPath);
  }
  for (const directory of directories) {
    const normalized = validateRelativePath(directory);
    await ensureSafeDirectory(id, normalized);
  }
  for (const file of files) {
    const relativePath = validateRelativePath(file?.path);
    if (typeof file?.content !== 'string' || Buffer.byteLength(file.content, 'utf8') > maxFileBytes) continue;
    await writeWorkspaceFile(id, relativePath, file.content);
  }
  return { synced: desired.size };
}

function runProcess(binary, args, timeoutMs, maxOutputBytes = 750_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < maxOutputBytes) {
        const piece = chunk.toString('utf8');
        stdout += piece.slice(0, maxOutputBytes - stdoutBytes);
        stdoutBytes += chunk.length;
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderrBytes < maxOutputBytes) {
        const piece = chunk.toString('utf8');
        stderr += piece.slice(0, maxOutputBytes - stderrBytes);
        stderrBytes += chunk.length;
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Could not start Docker: ' + error.message), { status: 503 }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code ?? 1, stdout, stderr, timedOut });
    });
  });
}

const portProxyCache = new Map();

function runtimeContainerName(workspaceId, environmentKey) {
  return `devcollab-${validateWorkspaceId(workspaceId)}-${environmentKey.replace(/[^a-z0-9-]/gi, '-')}`;
}

async function ensureRuntimeContainer(workspaceId, profile, environmentKey) {
  if (!profile) throw Object.assign(new Error('Choose an available runtime.'), { status: 422 });
  const id = validateWorkspaceId(workspaceId);
  const directory = workspaceDirectory(id);
  await mkdir(directory, { recursive: true });
  const name = runtimeContainerName(id, environmentKey);
  const inspect = await runProcess(dockerBin, ['inspect', '--format', '{{.State.Running}}', name], 5_000, 2_000);
  if (inspect.code === 0) {
    if (inspect.stdout.trim() === 'true') return name;
    const started = await runProcess(dockerBin, ['start', name], 15_000, 2_000);
    if (started.code !== 0) throw Object.assign(new Error(started.stderr.trim() || 'Could not start the workspace runtime container.'), { status: 503 });
    return name;
  }
  if (!/no such (?:object|container)|not found/i.test(inspect.stderr)) throw Object.assign(new Error(inspect.stderr.trim() || 'Could not inspect the workspace runtime container.'), { status: 503 });
  const started = await runProcess(dockerBin, [
    'run', '--detach', '--name', name, '--network', network,
    '--memory=768m', '--memory-swap=768m', '--cpus=1', '--pids-limit=128',
    '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--mount', 'type=bind,source=' + directory + ',target=/workspace',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp',
    '--entrypoint', '/bin/sh', profile.image, '-lc', 'while :; do sleep 3600; done',
  ], 120_000, 200_000);
  if (started.code !== 0) throw Object.assign(new Error(started.stderr.trim() || 'Could not start the workspace runtime container.'), { status: 503 });
  return name;
}

async function inspectRuntimeIp(containerName) {
  const result = await runProcess(dockerBin, ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', containerName], 5_000, 2_000);
  const address = result.stdout.trim().split(/\s+/).find(Boolean);
  if (result.code !== 0 || !address) throw Object.assign(new Error('The workspace container has no reachable network address.'), { status: 503 });
  return address;
}

async function ensurePortProxy(workspaceId, profileId, port, terminalType = 'language') {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Object.assign(new Error('Choose a port from 1024 to 65535.'), { status: 422 });
  if (network !== 'bridge') throw Object.assign(new Error('Port forwarding requires WORKSPACE_RUNNER_NETWORK=bridge.'), { status: 503 });
  const profile = terminalType === 'language' ? profiles[profileId] : terminalProfiles[terminalType];
  if (!profile) throw Object.assign(new Error('Choose a supported workspace runtime.'), { status: 422 });
  const id = validateWorkspaceId(workspaceId);
  const environmentKey = terminalType === 'language' ? 'lang-' + profileId : terminalType;
  const runtimeName = await ensureRuntimeContainer(id, profile, environmentKey);
  const targetIp = await inspectRuntimeIp(runtimeName);
  const name = `devcollab-port-${id}-${port}`;
  const cacheKey = `${id}:${port}`;
  const cached = portProxyCache.get(cacheKey);
  if (cached?.targetIp === targetIp && cached?.environmentKey === environmentKey) return cached;
  const previous = await runProcess(dockerBin, ['rm', '--force', name], 10_000, 2_000);
  void previous;
  const relay = "const net=require('node:net');const server=net.createServer(client=>{const upstream=net.connect(Number(process.env.TARGET_PORT),process.env.TARGET_HOST,()=>client.pipe(upstream));upstream.pipe(client);upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy())});server.listen(8080,'0.0.0.0')";
  const created = await runProcess(dockerBin, [
    'run', '--detach', '--name', name, '--network', network, '--publish', '127.0.0.1::8080',
    '--memory=64m', '--cpus=.25', '--pids-limit=32', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--env', 'TARGET_HOST=' + targetIp, '--env', 'TARGET_PORT=' + port, 'node:22-alpine', '-e', relay,
  ], 120_000, 200_000);
  if (created.code !== 0) throw Object.assign(new Error(created.stderr.trim() || 'Could not create the port-forwarding relay.'), { status: 503 });
  const published = await runProcess(dockerBin, ['port', name, '8080/tcp'], 5_000, 2_000);
  const localPort = Number(published.stdout.trim().split(/\r?\n/)[0].split(':').at(-1));
  if (published.code !== 0 || !Number.isInteger(localPort)) throw Object.assign(new Error('Could not allocate a port-forwarding address.'), { status: 503 });
  const result = { name, hostPort: localPort, targetIp, environmentKey };
  portProxyCache.set(cacheKey, result);
  return result;
}

async function proxyWorkspacePort(req, res, workspaceId, profileId, terminalType, port, proxyPath) {
  const relay = await ensurePortProxy(workspaceId, profileId, port, terminalType);
  const requestUrl = new URL(req.url || '/', 'http://' + host + ':' + port);
  requestUrl.searchParams.delete('_devcollabProfile');
  requestUrl.searchParams.delete('_devcollabType');
  const upstreamPath = proxyPath.replace(/^\/proxy/, '') || '/';
  const suffix = requestUrl.searchParams.size ? `?${requestUrl.searchParams}` : '';
  const headers = { ...req.headers, host: `127.0.0.1:${port}`, 'accept-encoding': 'identity' };
  for (const header of ['connection', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'cookie', 'authorization']) delete headers[header];
  const upstream = httpRequest({ host: '127.0.0.1', port: relay.hostPort, path: upstreamPath + suffix, method: req.method, headers }, (upstreamRes) => {
    const responseHeaders = { ...upstreamRes.headers };
    for (const header of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'set-cookie']) delete responseHeaders[header];
    const prefix = `/api/workspaces/${workspaceId}/ports/${port}/proxy`;
    if (typeof responseHeaders.location === 'string' && responseHeaders.location.startsWith('/') && !responseHeaders.location.startsWith('//')) responseHeaders.location = prefix + responseHeaders.location;
    const contentType = String(responseHeaders['content-type'] || '');
    if (/text\/html|text\/css|javascript|ecmascript/i.test(contentType) && !responseHeaders['content-encoding'] && req.method !== 'HEAD') {
      const chunks = [];
      let size = 0;
      let buffering = true;
      upstreamRes.on('data', (chunk) => {
        size += chunk.length;
        if (buffering && size <= 4_000_000) { chunks.push(chunk); return; }
        if (buffering) { buffering = false; res.writeHead(upstreamRes.statusCode || 502, responseHeaders); chunks.forEach((part) => res.write(part)); }
        res.write(chunk);
      });
      upstreamRes.on('end', () => {
        if (!buffering) { res.end(); return; }
        let body = Buffer.concat(chunks).toString('utf8');
        if (/text\/html/i.test(contentType)) body = body.replace(/((?:src|href|action)=(?:"|'))\/(?!\/)/gi, `$1${prefix}/`);
        if (/text\/css/i.test(contentType)) body = body.replace(/url\((\s*["']?)\/(?!\/)/gi, `url($1${prefix}/`).replace(/@import\s+(["'])\/(?!\/)/gi, `@import $1${prefix}/`);
        if (/javascript|ecmascript/i.test(contentType)) body = body.replace(/(["'`])\/(?!\/)([^"'`\s]*)\1/g, (match, quote, path) => quote + prefix + '/' + path + quote);
        const output = Buffer.from(body);
        responseHeaders['content-length'] = String(output.length);
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        res.end(output);
      });
      upstreamRes.on('error', (error) => { if (!res.headersSent) sendJson(res, 502, { message: error.message }); else res.destroy(error); });
      return;
    }
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (error) => { if (!res.headersSent) sendJson(res, 502, { message: `Port ${port} is not responding: ${error.message}` }); else res.destroy(error); });
  req.pipe(upstream);
}
async function executeWorkspaceCommand(workspaceId, command, profileId, terminalType = 'language', cwd = '') {
  if (typeof command !== 'string' || !command.trim() || command.length > 2_000) throw Object.assign(new Error('Enter a command up to 2,000 characters.'), { status: 422 });
  const profile = terminalType === 'language' ? profiles[profileId] : terminalProfiles[terminalType];
  if (!profile) throw Object.assign(new Error('Choose an available terminal or language environment.'), { status: 422 });
  const id = validateWorkspaceId(workspaceId);
  const relativeCwd = validateWorkspaceCwd(cwd);
  const containerCwd = relativeCwd ? '/workspace/' + relativeCwd : '/workspace';
  const directory = workspaceDirectory(id);
  const environmentKey = terminalType === 'language' ? 'lang-' + profileId : terminalType;
  const containerName = await ensureRuntimeContainer(id, profile, environmentKey);
  const before = await scanWorkspace(id);
  const cwdMarker = '__DEVCOLLAB_CWD_' + randomBytes(8).toString('hex') + '__';
  const wrappedCommand = profile.kind === 'powershell'
    ? `${command}\n$__devcollabStatus = if ($?) { 0 } else { 1 }\nWrite-Output ('${cwdMarker}' + (Get-Location).Path)\nexit $__devcollabStatus`
    : `${command}\n__devcollab_status=$?\nprintf '\\n${cwdMarker}%s\\n' "$PWD"\nexit "$__devcollab_status"`;
  const shellArgs = profile.kind === 'powershell' ? ['-NoLogo', '-NoProfile', '-Command', wrappedCommand] : ['-lc', wrappedCommand];
  const execution = await runProcess(dockerBin, ['exec', '--workdir=' + containerCwd, containerName, 'timeout', '140s', profile.shell, ...shellArgs], 145_000);
  let currentCwd = relativeCwd;
  const markerAt = execution.stdout.lastIndexOf(cwdMarker);
  if (markerAt >= 0) {
    const rawCwd = execution.stdout.slice(markerAt + cwdMarker.length).split(/\r?\n/, 1)[0].trim();
    if (rawCwd === '/workspace') currentCwd = '';
    else if (rawCwd.startsWith('/workspace/')) {
      try { currentCwd = validateRelativePath(rawCwd.slice('/workspace/'.length)); } catch { currentCwd = ''; }
    } else currentCwd = '';
    execution.stdout = execution.stdout.slice(0, markerAt).replace(/\r?\n$/, '');
  }
  if (execution.timedOut || execution.code === 124) execution.stderr += (execution.stderr ? '\n' : '') + 'Command stopped after the 140-second time limit.';
  const after = await scanWorkspace(id);
  const changedFiles = [];
  for (const [filePath, content] of after.files) if (before.files.get(filePath) !== content) changedFiles.push({ path: filePath, content });
  const deletedFiles = [...before.files.keys()].filter((filePath) => !after.files.has(filePath) && !after.unsupported.has(filePath));
  return { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.code, cwd: currentCwd, files: changedFiles.slice(0, maxFiles), deletedFiles: deletedFiles.slice(0, maxFiles), directories: after.directories, unsupportedPaths: [...after.unsupported].slice(0, 100) };
}
async function handleRequest(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { message: 'Runner authentication failed.' });
  const url = new URL(req.url || '/', 'http://' + host + ':' + port);
  if (req.method === 'GET' && url.pathname === '/v1/health') {
    const docker = await runProcess(dockerBin, ['info', '--format', '{{.ServerVersion}}'], 5_000, 2_000);
    if (docker.code !== 0) return sendJson(res, 503, { message: docker.stderr.trim() || 'Docker Desktop is not running.' });
    return sendJson(res, 200, { data: { online: true, dockerVersion: docker.stdout.trim(), capabilities: { terminal: true, git: false, preview: network === 'bridge', ports: network === 'bridge' } } });
  }
  const portCreate = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{24})\/ports$/i);
  if (req.method === 'POST' && portCreate) {
    const body = await readJson(req);
    const result = await ensurePortProxy(validateWorkspaceId(portCreate[1]), body.profile || 'node', Number(body.port), body.terminalType || 'language');
    return sendJson(res, 200, { data: { port: Number(body.port), ready: true, localPort: result.hostPort } });
  }
  const portDelete = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{24})\/ports\/(\d+)$/i);
  if (req.method === 'DELETE' && portDelete) {
    const id = validateWorkspaceId(portDelete[1]);
    const port = Number(portDelete[2]);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Object.assign(new Error('Choose a valid port.'), { status: 422 });
    const result = await runProcess(dockerBin, ['rm', '--force', `devcollab-port-${id}-${port}`], 10_000, 2_000);
    void result;
    portProxyCache.delete(`${id}:${port}`);
    return sendJson(res, 200, { data: { removed: true, port } });
  }
  const portProxy = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{24})\/ports\/(\d+)\/(proxy(?:\/.*)?)$/i);
  if (portProxy) return proxyWorkspacePort(req, res, validateWorkspaceId(portProxy[1]), url.searchParams.get('_devcollabProfile') || 'node', url.searchParams.get('_devcollabType') || 'language', Number(portProxy[2]), `/${portProxy[3]}`);
  const workspaceDelete = url.pathname.match(/^\/v1\/workspaces\/([a-f0-9]{24})$/i);
  if (req.method === 'DELETE' && workspaceDelete) {
    const id = validateWorkspaceId(workspaceDelete[1]);
    const prefixes = [`devcollab-${id}-`, `devcollab-port-${id}-`];
    const names = new Set();
    for (const prefix of prefixes) {
      const listed = await runProcess(dockerBin, ['ps', '--all', '--filter', `name=${prefix}`, '--format', '{{.Names}}'], 10_000, 10_000);
      listed.stdout.split(/\r?\n/).map((name) => name.trim()).filter((name) => name.startsWith(prefix)).forEach((name) => names.add(name));
    }
    if (names.size) await runProcess(dockerBin, ['rm', '--force', ...names], 30_000, 10_000);
    portProxyCache.forEach((_, key) => { if (key.startsWith(`${id}:`)) portProxyCache.delete(key); });
    await rm(workspaceDirectory(id), { recursive: true, force: true });
    return sendJson(res, 200, { data: { removed: true } });
  }  const match = url.pathname.match(new RegExp('^/v1/workspaces/([a-f0-9]{24})/(files(?:/sync)?|exec|git|preview)$', 'i'));
  if (!match) return sendJson(res, 404, { message: 'Runner route not found.' });
  const workspaceId = validateWorkspaceId(match[1]);
  const action = match[2];
  if (action === 'files' && req.method === 'PUT') {
    const body = await readJson(req);
    const relativePath = validateRelativePath(body.path);
    await writeWorkspaceFile(workspaceId, relativePath, body.content);
    return sendJson(res, 200, { data: { path: relativePath, synced: true } });
  }
  if (action === 'files' && req.method === 'DELETE') {
    const body = await readJson(req);
    const relativePath = validateRelativePath(body.path);
    await removeWorkspaceFile(workspaceId, relativePath);
    return sendJson(res, 200, { data: { path: relativePath, deleted: true } });
  }
  if (action === 'files/sync' && req.method === 'POST') {
    const body = await readJson(req);
    const result = await syncWorkspace(workspaceId, body.files, body.directories || []);
    return sendJson(res, 200, { data: result });
  }
  if (action === 'exec' && req.method === 'POST') {
    const body = await readJson(req);
    const result = await executeWorkspaceCommand(workspaceId, body.command, body.profile || 'node', body.terminalType || 'language', body.cwd || '');
    return sendJson(res, 200, { data: result });
  }
  if (action === 'git' || action === 'preview') return sendJson(res, 501, { message: 'This local runner provides isolated terminal commands and file sync. Git and preview need a dedicated runner.' });
  return sendJson(res, 405, { message: 'Method not allowed.' });
}

if (!token) {
  console.error('WORKSPACE_RUNNER_TOKEN is missing. Add it to server/.env before starting the runner.');
  process.exit(1);
}

await mkdir(root, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > maxJsonBytes) return sendJson(res, 413, { message: 'Request body is too large.' });
    await handleRequest(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, { message: error.message || 'Runner request failed.' });
  }
});
server.listen(port, host, () => console.info('DEVCOLLAB isolated runner listening on ' + host + ':' + port));
