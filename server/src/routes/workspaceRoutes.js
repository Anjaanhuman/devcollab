import { Router } from 'express';
import mongoose from 'mongoose';
import { deflateRawSync } from 'node:zlib';
import { authenticate } from '../middleware/auth.js';
import Project from '../models/Project.js';
import Workspace from '../models/Workspace.js';
import WorkspaceActivity from '../models/WorkspaceActivity.js';
import WorkspaceFile from '../models/WorkspaceFile.js';
import { ensureWorkspaceForProject } from '../services/ensureWorkspaceForProject.js';
import { callWorkspaceRunner, deleteRunnerFile, proxyWorkspaceRunnerRequest, syncRunnerFile, syncRunnerWorkspace, workspaceRunnerConfigured, workspaceRunnerHealth } from '../services/workspaceRunner.js';
import { isProjectMember, projectRole } from '../utils/projectAccess.js';
import { success, isValidObjectId } from '../utils/api.js';

const router = Router();
const MAX_FILE_BYTES = 1_048_576;
const MAX_WORKSPACE_BYTES = 52_428_800;
const MAX_WORKSPACE_FILES = 2_000;
const MAX_WORKSPACE_DIRECTORIES = 2_000;
const terminalTypes = new Set(['language', 'bash', 'ubuntu', 'git', 'powershell']);
const ZIP_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < ZIP_CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  ZIP_CRC_TABLE[index] = value >>> 0;
}

function zipCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const now = new Date();
  const zipTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const zipDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8');
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content || '', 'utf8');
    const compressed = deflateRawSync(content, { level: 6 });
    const checksum = zipCrc32(content);
    const flags = 0x0800;
    const method = 8;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(zipTime, 10);
    localHeader.writeUInt16LE(zipDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, fileName, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(zipTime, 12);
    centralHeader.writeUInt16LE(zipDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(entry.isDirectory ? 0x10 : 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, fileName);

    localOffset += localHeader.length + fileName.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function safeZipName(value) {
  return String(value || 'devcollab')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100) || 'devcollab';
}

const languageProfiles = [
  { id: 'node', name: 'Node.js', image: 'node:22-bookworm-slim', extensions: ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'] },
  { id: 'python', name: 'Python', image: 'python:3.13-slim', extensions: ['py'] },
  { id: 'java', name: 'Java', image: 'eclipse-temurin:21-jdk', extensions: ['java'] },
  { id: 'go', name: 'Go', image: 'golang:1.25-bookworm', extensions: ['go'] },
  { id: 'rust', name: 'Rust', image: 'rust:1.90-slim', extensions: ['rs'] },
  { id: 'cpp', name: 'C / C++', image: 'gcc:15', extensions: ['c', 'h', 'cc', 'cpp', 'hpp'] },
  { id: 'php', name: 'PHP', image: 'php:8.4-cli', extensions: ['php'] },
  { id: 'ruby', name: 'Ruby', image: 'ruby:3.4-slim', extensions: ['rb'] },
  { id: 'dotnet', name: '.NET', image: 'mcr.microsoft.com/dotnet/sdk:10.0', extensions: ['cs', 'fs', 'vb'] },
  { id: 'kotlin', name: 'Kotlin', image: 'gradle:9-jdk21', extensions: ['kt', 'kts'] },
  { id: 'swift', name: 'Swift', image: 'swift:6.2', extensions: ['swift'] },
  { id: 'dart', name: 'Dart', image: 'dart:stable', extensions: ['dart'] },
  { id: 'elixir', name: 'Elixir', image: 'elixir:1.19', extensions: ['ex', 'exs'] },
  { id: 'haskell', name: 'Haskell', image: 'haskell:9.12', extensions: ['hs', 'lhs'] },
  { id: 'lua', name: 'Lua', image: 'lua:5.4', extensions: ['lua'] },
  { id: 'perl', name: 'Perl', image: 'perl:5.42', extensions: ['pl', 'pm'] },
  { id: 'r', name: 'R', image: 'r-base:4.5.2', extensions: ['r', 'R'] },
  { id: 'scala', name: 'Scala', image: 'scala:3.7.2', extensions: ['scala', 'sc'] },
  { id: 'clojure', name: 'Clojure', image: 'clojure:1.12-tools-deps', extensions: ['clj', 'cljs', 'cljc'] },
  { id: 'bash', name: 'Bash / Shell', image: 'bash:5.2', extensions: ['sh', 'bash'] },
];

export function normalizeWorkspacePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\0') || value.includes('\\') || value.startsWith('/')) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.length > 100)) return null;
  return parts.join('/');
}

function collectWorkspaceDirectories(filePaths, storedDirectories = []) {
  const directories = new Set(storedDirectories.map(String));
  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? current + '/' + part : part;
      directories.add(current);
    }
  }
  return directories;
}

async function accessWorkspace(workspaceId, userId) {
  if (!isValidObjectId(workspaceId)) return { error: 'Workspace not found.', status: 404 };
  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) return { error: 'Workspace not found.', status: 404 };
  const project = await Project.findById(workspace.projectId).select('owner members moderationStatus title');
  if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, userId)) return { error: 'Workspace access denied.', status: 404 };
  const member = project.members.find((entry) => String(entry.user) === String(userId));
  const role = String(project.owner) === String(userId) ? 'owner' : member?.workspaceRole || 'editor';
  return { workspace, project, role, canWrite: role !== 'viewer' };
}

async function recordActivity(workspaceId, userId, type, path, summary = '') {
  await WorkspaceActivity.create({ workspaceId, userId, type, path: path || '', summary });
}

router.get('/project/:projectId', authenticate, async (req, res) => {
  if (!isValidObjectId(req.params.projectId)) return success(res, 'Project not found.', null, 404);
  const project = await Project.findById(req.params.projectId).select('title owner members moderationStatus');
  if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, req.user._id)) return success(res, 'Project workspace not found.', null, 404);
  await project.populate('members.user', 'fullName username avatarUrl');
  const workspace = await ensureWorkspaceForProject(project);
  const runner = await workspaceRunnerHealth();
  const files = await WorkspaceFile.find({ workspaceId: workspace._id }).select('path version updatedAt updatedBy').sort({ path: 1 }).lean();
  const activity = await WorkspaceActivity.find({ workspaceId: workspace._id }).populate('userId', 'username fullName avatarUrl').sort({ createdAt: -1 }).limit(30).lean();
  return success(res, 'Workspace loaded.', {
    workspace,
    project: { _id: project._id, title: project.title, members: project.members },
    files,
    activity,
    permissions: { role: projectRole(project, req.user._id), canWrite: String(project.owner) === String(req.user._id) || project.members.find((entry) => String(entry.user?._id ?? entry.user) === String(req.user._id))?.workspaceRole !== 'viewer' },
    runtime: { ...runner, profiles: languageProfiles.map(({ id, name, extensions }) => ({ id, name, extensions })) },
  });
});

router.get('/:workspaceId/files', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  const files = await WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path version updatedAt updatedBy').sort({ path: 1 }).lean();
  return success(res, 'Workspace files loaded.', files);
});

router.get('/:workspaceId/download.zip', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  const scope = String(req.query.scope || '');
  if (!['project', 'folder', 'file'].includes(scope)) return success(res, 'Choose project, folder, or file for the ZIP download.', null, 422);
  const requestedPath = scope === 'project' ? '' : normalizeWorkspacePath(req.query.path);
  if (scope !== 'project' && !requestedPath) return success(res, 'Choose a valid folder or file.', null, 422);

  const allPaths = await WorkspaceFile.find({ workspaceId: access.workspace._id }).distinct('path');
  const directoryPaths = new Set((access.workspace.directories || []).map(String));
  for (const filePath of allPaths) {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? current + '/' + part : part;
      directoryPaths.add(current);
    }
  }

  let selectedPaths = [];
  let archiveEntries = [];
  let archiveBaseName = safeZipName(access.project.title);
  if (scope === 'project') {
    selectedPaths = allPaths;
    archiveEntries = [...directoryPaths].sort().map((directory) => ({ name: directory + '/', content: '', isDirectory: true }));
  } else if (scope === 'folder') {
    if (!directoryPaths.has(requestedPath)) return success(res, 'That folder no longer exists.', null, 404);
    selectedPaths = allPaths.filter((filePath) => filePath.startsWith(requestedPath + '/'));
    archiveEntries = [...directoryPaths]
      .filter((directory) => directory === requestedPath || directory.startsWith(requestedPath + '/'))
      .sort()
      .map((directory) => ({ name: directory + '/', content: '', isDirectory: true }));
    archiveBaseName = safeZipName(requestedPath.split('/').pop());
  } else {
    if (!allPaths.includes(requestedPath)) return success(res, 'That file no longer exists.', null, 404);
    selectedPaths = [requestedPath];
    archiveBaseName = safeZipName(requestedPath.split('/').pop());
  }

  const io = req.app.get('io');
  for (const filePath of selectedPaths) await io?.flushWorkspaceFile?.(access.workspace._id, filePath);
  const fileRows = selectedPaths.length
    ? await WorkspaceFile.find({ workspaceId: access.workspace._id, path: { $in: selectedPaths } }).select('path content').sort({ path: 1 }).lean()
    : [];
  for (const file of fileRows) {
    const name = scope === 'file' ? file.path.split('/').pop() : file.path;
    archiveEntries.push({ name, content: file.content || '', isDirectory: false });
  }
  archiveEntries.sort((left, right) => left.name.localeCompare(right.name));
  if (archiveEntries.length > 65_535) return success(res, 'This workspace contains too many entries for one ZIP file.', null, 413);
  const archiveName = archiveBaseName + '.zip';
  const fallbackName = archiveName.replace(/[^A-Za-z0-9._-]/g, '_');
  const archive = createZipBuffer(archiveEntries);
  res.status(200)
    .set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename=' + fallbackName + '; filename*=UTF-8\'\'' + encodeURIComponent(archiveName),
      'Content-Length': String(archive.length),
      'Cache-Control': 'no-store',
    })
    .send(archive);
});

router.post('/:workspaceId/directories', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const path = normalizeWorkspacePath(req.body?.path);
  if (!path) return success(res, 'Enter a valid folder path.', null, 422);

  const requestedDirectories = [];
  let currentPath = '';
  for (const segment of path.split('/')) {
    currentPath = currentPath ? currentPath + '/' + segment : segment;
    requestedDirectories.push(currentPath);
  }
  const filePaths = await WorkspaceFile.find({ workspaceId: access.workspace._id }).distinct('path');
  const conflict = filePaths.some((filePath) => requestedDirectories.some((directory) => directory === filePath || directory.startsWith(filePath + '/')));
  if (conflict) return success(res, 'A file already uses this folder path.', null, 409);

  const existing = collectWorkspaceDirectories(filePaths, access.workspace.directories || []);
  const created = requestedDirectories.filter((directory) => !existing.has(directory));
  if (existing.size + created.length > MAX_WORKSPACE_DIRECTORIES) return success(res, 'This workspace has reached its folder limit.', null, 409);
  const directories = [...existing, ...created];
  if (created.length) {
    access.workspace.directories = directories;
    await access.workspace.save();
    req.app.get('io')?.to('workspace:' + access.workspace._id).emit('workspace:directory:created', { directories });
  }
  return success(res, created.length ? 'Folder created.' : 'Folder already exists.', { directories, created }, created.length ? 201 : 200);
});
router.get('/:workspaceId/file', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  const path = normalizeWorkspacePath(req.query.path);
  if (!path) return success(res, 'Enter a valid file path.', null, 422);
  const file = await WorkspaceFile.findOne({ workspaceId: access.workspace._id, path }).select('path content version updatedAt updatedBy').lean();
  if (!file) return success(res, 'File not found.', null, 404);
  return success(res, 'Workspace file loaded.', file);
});

router.post('/:workspaceId/files', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const path = normalizeWorkspacePath(req.body?.path);
  const content = req.body?.content ?? '';
  if (!path || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return success(res, 'Enter a valid file path and text content under 1 MB.', null, 422);
  const [count, bytes, exists, existingPaths] = await Promise.all([
    WorkspaceFile.countDocuments({ workspaceId: access.workspace._id }),
    WorkspaceFile.aggregate([{ $match: { workspaceId: new mongoose.Types.ObjectId(String(access.workspace._id)) } }, { $group: { _id: null, total: { $sum: { $strLenBytes: '$content' } } } }]),
    WorkspaceFile.exists({ workspaceId: access.workspace._id, path }),
    WorkspaceFile.find({ workspaceId: access.workspace._id }).distinct('path'),
  ]);
  if (exists) return success(res, 'A file already exists at that path.', null, 409);
  const existingPathSet = new Set(existingPaths);
  const parentParts = path.split('/');
  parentParts.pop();
  let parentPath = '';
  for (const part of parentParts) {
    parentPath = parentPath ? parentPath + '/' + part : part;
    if (existingPathSet.has(parentPath)) return success(res, 'A file already uses part of this path.', null, 409);
  }
  if (collectWorkspaceDirectories(existingPaths, access.workspace.directories || []).has(path)) {
    return success(res, 'A folder already exists at that path.', null, 409);
  }
  if (collectWorkspaceDirectories([...existingPaths, path], access.workspace.directories || []).size > MAX_WORKSPACE_DIRECTORIES) {
    return success(res, 'This workspace has reached its folder limit.', null, 409);
  }
  if (count >= MAX_WORKSPACE_FILES) return success(res, 'This workspace has reached its 2,000-file limit.', null, 409);
  if ((bytes[0]?.total || 0) + Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_BYTES) return success(res, 'This workspace has reached its 50 MB file storage limit.', null, 413);
  let file;
  try {
    file = await WorkspaceFile.create({ workspaceId: access.workspace._id, path, content, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (error) {
    if (error?.code === 11000) return success(res, 'A file already exists at that path.', null, 409);
    throw error;
  }
  let runnerSync = { configured: false };
  if (workspaceRunnerConfigured()) {
    try { await syncRunnerFile(access.workspace._id, path, content); runnerSync = { configured: true, synced: true }; }
    catch (error) { runnerSync = { configured: true, synced: false, message: error.message }; }
  }
  await recordActivity(access.workspace._id, req.user._id, 'file_created', path, `Created ${path}`);
  req.app.get('io')?.to(`workspace:${access.workspace._id}`).emit('workspace:file:created', { path, version: file.version });
  return success(res, 'Workspace file created.', { path: file.path, content: file.content, version: file.version, updatedAt: file.updatedAt, runnerSync }, 201);
});

router.put('/:workspaceId/files', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const path = normalizeWorkspacePath(req.body?.path);
  const content = req.body?.content;
  if (!path || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return success(res, 'Enter a valid file path and text content under 1 MB.', null, 422);
  const file = await WorkspaceFile.findOne({ workspaceId: access.workspace._id, path }).select('+collaborationState');
  if (!file) return success(res, 'File not found.', null, 404);
  if (await req.app.get('io')?.isWorkspaceFileActive?.(access.workspace._id, path)) return success(res, 'This file is open in a live editor session. Reconnect to save through collaboration.', { version: file.version }, 409);
  if (file.collaborationState?.length) return success(res, 'This file has synchronized collaboration history. Reconnect the live editor before saving offline changes.', { version: file.version }, 409);
  if (Number.isInteger(req.body.version) && req.body.version !== file.version) return success(res, 'This file changed in another session. Reload it before saving.', { version: file.version, content: file.content }, 409);
  const otherUsage = await WorkspaceFile.aggregate([
    { $match: { workspaceId: access.workspace._id, _id: { $ne: file._id } } },
    { $group: { _id: null, total: { $sum: { $strLenBytes: '$content' } } } },
  ]);
  if ((otherUsage[0]?.total || 0) + Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_BYTES) return success(res, 'This workspace has reached its 50 MB file storage limit.', null, 413);
  const oldPath = file.path;
  file.content = content;
  file.updatedBy = req.user._id;
  file.version += 1;
  await file.save();
  req.app.get('io')?.invalidateWorkspaceFile?.(access.workspace._id, path);
  let runnerSync = { configured: false };
  if (workspaceRunnerConfigured()) {
    try { await syncRunnerFile(access.workspace._id, path, content); runnerSync = { configured: true, synced: true }; }
    catch (error) { runnerSync = { configured: true, synced: false, message: error.message }; }
  }
  await recordActivity(access.workspace._id, req.user._id, 'file_saved', oldPath, `Saved ${oldPath}`);
  req.app.get('io')?.to(`workspace:${access.workspace._id}`).emit('workspace:file:saved', { path: oldPath, version: file.version, content });
  return success(res, 'Workspace file saved.', { path: file.path, version: file.version, updatedAt: file.updatedAt, runnerSync });
});

router.delete('/:workspaceId/files', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const path = normalizeWorkspacePath(req.body?.path);
  if (!path) return success(res, 'Enter a valid file path.', null, 422);
  const deleted = await WorkspaceFile.findOneAndDelete({ workspaceId: access.workspace._id, path });
  if (!deleted) return success(res, 'File not found.', null, 404);
  req.app.get('io')?.invalidateWorkspaceFile?.(access.workspace._id, path);
  if (workspaceRunnerConfigured()) await deleteRunnerFile(access.workspace._id, path).catch((error) => console.error('Could not remove a workspace file from the runner.', error.message));
  await recordActivity(access.workspace._id, req.user._id, 'file_deleted', path, `Deleted ${path}`);
  req.app.get('io')?.to(`workspace:${access.workspace._id}`).emit('workspace:file:deleted', { path });
  return success(res, 'Workspace file deleted.');
});

router.patch('/:workspaceId/move', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const source = normalizeWorkspacePath(req.body?.source);
  const requestedTarget = req.body?.targetDirectory;
  const targetDirectory = requestedTarget === '' ? '' : normalizeWorkspacePath(requestedTarget);
  const hasNewName = req.body?.newName !== undefined;
  const newName = hasNewName ? normalizeWorkspacePath(req.body.newName) : null;
  if (!source || (requestedTarget !== '' && !targetDirectory) || (hasNewName && (!newName || newName.includes('/')))) return success(res, 'Choose a valid file or folder name and destination.', null, 422);

  const [fileRows, storedDirectories] = await Promise.all([
    WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path').lean(),
    Promise.resolve((access.workspace.directories || []).map(String)),
  ]);
  const allFilePaths = fileRows.map((file) => file.path);
  const directories = new Set(storedDirectories);
  for (const filePath of allFilePaths) {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? current + '/' + part : part;
      directories.add(current);
    }
  }
  const sourceIsFile = allFilePaths.includes(source);
  const sourceIsDirectory = directories.has(source);
  if (!sourceIsFile && !sourceIsDirectory) return success(res, 'The file or folder no longer exists.', null, 404);
  if (targetDirectory && !directories.has(targetDirectory)) return success(res, 'Choose a folder that exists in this workspace.', null, 404);
  if (sourceIsDirectory && (targetDirectory === source || targetDirectory.startsWith(source + '/'))) return success(res, 'A folder cannot be moved inside itself.', null, 422);

  const sourceName = source.split('/').pop();
  const destinationName = newName || sourceName;
  const renamed = Boolean(newName && newName !== sourceName);
  const destinationRoot = targetDirectory ? targetDirectory + '/' + destinationName : destinationName;
  if (destinationRoot === source) return success(res, renamed ? 'This item already has that name.' : 'This item is already in that folder.', { source, targetDirectory, directories: [...directories].sort() });
  if (sourceIsDirectory && directories.has(destinationRoot)) return success(res, 'A folder with that name already exists in the destination.', null, 409);
  const movingFiles = allFilePaths.filter((path) => sourceIsFile ? path === source : path.startsWith(source + '/'));
  const movingDirectories = sourceIsDirectory
    ? [...directories].filter((path) => path === source || path.startsWith(source + '/'))
    : [];
  const fileMappings = movingFiles.map((from) => ({
    from,
    to: sourceIsFile ? destinationRoot : destinationRoot + from.slice(source.length),
    kind: 'file',
  }));
  const directoryMappings = movingDirectories.map((from) => ({
    from,
    to: from === source ? destinationRoot : destinationRoot + from.slice(source.length),
    kind: 'directory',
  }));
  if (fileMappings.some(({ to }) => to.length > 240) || directoryMappings.some(({ to }) => to.length > 240)) return success(res, 'The destination path is too long.', null, 422);

  const movingFileSet = new Set(movingFiles);
  const nextFilePaths = [
    ...allFilePaths.filter((path) => !movingFileSet.has(path)),
    ...fileMappings.map(({ to }) => to),
  ];
  const nextFileSet = new Set(nextFilePaths);
  if (nextFileSet.size !== nextFilePaths.length) return success(res, 'A file already exists at the destination.', null, 409);
  for (const path of nextFilePaths) {
    const parts = path.split('/');
    parts.pop();
    let parent = '';
    for (const part of parts) {
      parent = parent ? parent + '/' + part : part;
      if (nextFileSet.has(parent)) return success(res, 'The destination conflicts with an existing file.', null, 409);
    }
  }

  const movingDirectorySet = new Set(movingDirectories);
  const nextDirectories = new Set([...directories].filter((path) => !movingDirectorySet.has(path)));
  for (const { to } of directoryMappings) nextDirectories.add(to);
  for (const filePath of fileMappings.map(({ to }) => to)) {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? current + '/' + part : part;
      nextDirectories.add(current);
    }
  }
  if (nextDirectories.size > MAX_WORKSPACE_DIRECTORIES) return success(res, 'This workspace has reached its folder limit.', null, 409);
  for (const directory of nextDirectories) {
    if (nextFileSet.has(directory)) return success(res, 'The destination conflicts with an existing file.', null, 409);
    const parts = directory.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (nextFileSet.has(parts.join('/'))) return success(res, 'The destination conflicts with an existing file.', null, 409);
    }
  }

  const io = req.app.get('io');
  for (const path of movingFiles) {
    if (await io?.isWorkspaceFileActive?.(access.workspace._id, path)) {
      return success(res, 'A moved file is still open by another workspace member. Ask them to close it, then try again.', { path }, 409);
    }
  }
  try {
    for (const path of movingFiles) await io?.flushWorkspaceFile?.(access.workspace._id, path);
  } catch (error) {
    return success(res, error.message || 'A file could not be saved before moving.', null, 409);
  }

  if (fileMappings.length) {
    await WorkspaceFile.bulkWrite(fileMappings.map(({ from, to }) => ({
      updateOne: { filter: { workspaceId: access.workspace._id, path: from }, update: { $set: { path: to, updatedBy: req.user._id } } },
    })));
  }
  access.workspace.directories = [...nextDirectories].sort();
  await access.workspace.save();
  for (const path of movingFiles) io?.invalidateWorkspaceFile?.(access.workspace._id, path);
  let runnerSync = { configured: false };
  if (workspaceRunnerConfigured()) {
    try {
      const currentFiles = await WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path content').lean();
      await syncRunnerWorkspace(access.workspace._id, currentFiles.map(({ path, content }) => ({ path, content })), access.workspace.directories || []);
      runnerSync = { configured: true, synced: true };
    } catch (error) {
      runnerSync = { configured: true, synced: false, message: error.message };
    }
  }
  await recordActivity(access.workspace._id, req.user._id, renamed ? 'file_renamed' : 'file_moved', source, renamed ? 'Renamed ' + source + ' to ' + destinationRoot : 'Moved ' + source + ' to ' + (targetDirectory || 'workspace root'));
  io?.to('workspace:' + access.workspace._id).emit('workspace:files:moved', {
    source,
    targetDirectory,
    mappings: [...fileMappings, ...directoryMappings],
    directories: access.workspace.directories,
  });
  return success(res, 'Workspace item moved.', {
    source,
    targetDirectory,
    mappings: [...fileMappings, ...directoryMappings],
    directories: access.workspace.directories,
    runnerSync,
  });
});

router.get('/:workspaceId/activity', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  const activity = await WorkspaceActivity.find({ workspaceId: access.workspace._id }).populate('userId', 'username fullName avatarUrl').sort({ createdAt: -1 }).limit(100).lean();
  return success(res, 'Workspace activity loaded.', activity);
});

router.get('/:workspaceId/search', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  const query = String(req.query.q || '').trim().slice(0, 100);
  if (!query) return success(res, 'Enter text to search.', []);
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const files = await WorkspaceFile.find({ workspaceId: access.workspace._id, $or: [{ path: pattern }, { content: pattern }] }).select('path updatedAt').sort({ path: 1 }).limit(50).lean();
  return success(res, 'Workspace search completed.', files);
});

router.patch('/:workspaceId/settings', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const { fontSize, tabSize, wordWrap, runtimeProfile } = req.body || {};
  if (fontSize !== undefined && (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 30)) return success(res, 'Font size must be between 10 and 30.', null, 422);
  if (tabSize !== undefined && (!Number.isInteger(tabSize) || tabSize < 2 || tabSize > 8)) return success(res, 'Tab size must be between 2 and 8.', null, 422);
  if (wordWrap !== undefined && !['off', 'on', 'wordWrapColumn', 'bounded'].includes(wordWrap)) return success(res, 'Choose a valid word wrap setting.', null, 422);
  const profiles = languageProfiles.map(({ id }) => id);
  if (runtimeProfile !== undefined && !profiles.includes(runtimeProfile)) return success(res, 'Choose a supported runtime profile.', null, 422);
  if (fontSize !== undefined) access.workspace.settings.editor.fontSize = fontSize;
  if (tabSize !== undefined) access.workspace.settings.editor.tabSize = tabSize;
  if (wordWrap !== undefined) access.workspace.settings.editor.wordWrap = wordWrap;
  if (runtimeProfile !== undefined) access.workspace.runtimeProfile = runtimeProfile;
  await access.workspace.save();
  return success(res, 'Workspace settings saved.', { settings: access.workspace.settings, runtimeProfile: access.workspace.runtimeProfile });
});

router.get('/:workspaceId/runtime', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  const runner = await workspaceRunnerHealth();
  return success(res, 'Workspace runtime status loaded.', { ...runner, profiles: languageProfiles.map(({ id, name, image }) => ({ id, name, image })) });
});

router.post('/:workspaceId/terminal', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  if (typeof req.body?.command !== 'string' || !req.body.command.trim() || req.body.command.length > 2_000) return success(res, 'Enter a command up to 2,000 characters.', null, 422);
  const terminalType = req.body.terminalType || 'language';
  if (!terminalTypes.has(terminalType)) return success(res, 'Choose an available terminal type.', null, 422);
  const cwd = req.body.cwd ?? '';
  if (typeof cwd !== 'string' || (cwd !== '' && !normalizeWorkspacePath(cwd))) return success(res, 'Working directory must be inside the workspace.', null, 422);
  if (!workspaceRunnerConfigured()) return success(res, 'Isolated workspace runner is not configured. Files are available, but code execution is disabled until a runner is connected.', { configured: false }, 503);

  const io = req.app.get('io');
  const beforeFlush = await WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path content').lean();
  for (const file of beforeFlush) await io?.flushWorkspaceFile?.(access.workspace._id, file.path);
  const files = await WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path content').lean();
  await syncRunnerWorkspace(access.workspace._id, files.map(({ path, content }) => ({ path, content })), access.workspace.directories || []);
  const payload = await callWorkspaceRunner('/v1/workspaces/' + access.workspace._id + '/exec', {
    body: { command: req.body.command, profile: access.workspace.runtimeProfile, terminalType, cwd, userId: String(req.user._id) },
    timeoutMs: 180_000,
  });

  const existingFiles = new Map(files.map((file) => [file.path, file.content || '']));
  const originalDirectories = [...(access.workspace.directories || [])].map(String).sort();
  const nextFiles = new Map(existingFiles);
  const deletedPaths = [];
  const changedFiles = [];
  const invalidChanges = [];
  for (const rawPath of Array.isArray(payload.deletedFiles) ? payload.deletedFiles : []) {
    const filePath = normalizeWorkspacePath(rawPath);
    if (!filePath) { invalidChanges.push(String(rawPath)); continue; }
    if (nextFiles.delete(filePath)) deletedPaths.push(filePath);
  }
  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    const filePath = normalizeWorkspacePath(file?.path);
    if (!filePath || typeof file.content !== 'string' || Buffer.byteLength(file.content, 'utf8') > MAX_FILE_BYTES) {
      invalidChanges.push(String(file?.path || 'unknown'));
      continue;
    }
    if (nextFiles.get(filePath) !== file.content) {
      nextFiles.set(filePath, file.content);
      changedFiles.push({ path: filePath, content: file.content, created: !existingFiles.has(filePath) });
    }
  }

  const nextDirectories = new Set();
  for (const rawDirectory of Array.isArray(payload.directories) ? payload.directories : []) {
    const directory = normalizeWorkspacePath(rawDirectory);
    if (!directory) { invalidChanges.push(String(rawDirectory)); continue; }
    nextDirectories.add(directory);
  }
  for (const filePath of nextFiles.keys()) {
    const parts = filePath.split('/');
    parts.pop();
    let parent = '';
    for (const part of parts) {
      parent = parent ? parent + '/' + part : part;
      nextDirectories.add(parent);
    }
  }

  let workspaceSyncWarning = '';
  const filePaths = [...nextFiles.keys()];
  const filePathSet = new Set(filePaths);
  let totalBytes = 0;
  for (const [filePath, content] of nextFiles) {
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (nextDirectories.has(filePath)) invalidChanges.push(filePath);
    const parts = filePath.split('/');
    parts.pop();
    let parent = '';
    for (const part of parts) {
      parent = parent ? parent + '/' + part : part;
      if (filePathSet.has(parent)) invalidChanges.push(filePath);
    }
  }
  if (filePaths.length > MAX_WORKSPACE_FILES || totalBytes > MAX_WORKSPACE_BYTES || nextDirectories.size > MAX_WORKSPACE_DIRECTORIES) {
    workspaceSyncWarning = ' Command completed, but its file changes exceeded workspace storage limits and were not saved.';
  } else if (invalidChanges.length) {
    workspaceSyncWarning = ' Command completed, but some filesystem changes could not be synchronized to the shared workspace.';
  } else {
    if (deletedPaths.length) {
      await WorkspaceFile.deleteMany({ workspaceId: access.workspace._id, path: { $in: deletedPaths } });
      for (const filePath of deletedPaths) io?.invalidateWorkspaceFile?.(access.workspace._id, filePath);
    }
    const updates = changedFiles.filter((file) => existingFiles.has(file.path));
    if (updates.length) {
      await WorkspaceFile.bulkWrite(updates.map((file) => ({
        updateOne: {
          filter: { workspaceId: access.workspace._id, path: file.path },
          update: { $set: { content: file.content, updatedBy: req.user._id }, $unset: { collaborationState: 1 }, $inc: { version: 1 } },
        },
      })));
    }
    const creates = changedFiles.filter((file) => !existingFiles.has(file.path));
    if (creates.length) {
      await WorkspaceFile.insertMany(creates.map((file) => ({
        workspaceId: access.workspace._id,
        path: file.path,
        content: file.content,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      })));
    }
    for (const file of updates) io?.invalidateWorkspaceFile?.(access.workspace._id, file.path);
    access.workspace.directories = [...nextDirectories].sort();
    await access.workspace.save();
    const changedPaths = changedFiles.map((file) => file.path);
    const directoriesChanged = originalDirectories.length !== access.workspace.directories.length
      || originalDirectories.some((directory, index) => directory !== access.workspace.directories[index]);
    if (changedPaths.length || deletedPaths.length || directoriesChanged) {
      io?.to('workspace:' + access.workspace._id).emit('workspace:terminal:files:changed', {
        changedPaths,
        deletedPaths,
        directories: access.workspace.directories,
      });
    }
  }

  const result = {
    stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
    stderr: (typeof payload.stderr === 'string' ? payload.stderr : '') + workspaceSyncWarning,
    exitCode: Number.isInteger(payload.exitCode) ? payload.exitCode : 1,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : cwd,
    directories: access.workspace.directories,
    changedPaths: changedFiles.map((file) => file.path),
    deletedPaths,
  };
  await recordActivity(access.workspace._id, req.user._id, 'terminal', '', 'Ran a command in the ' + access.workspace.runtimeProfile + ' environment');
  return success(res, 'Command completed.', result);
});

router.post('/:workspaceId/git', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const actions = ['status', 'diff', 'commit', 'pull', 'push', 'branches'];
  if (!actions.includes(req.body?.action) || (req.body.action === 'commit' && (typeof req.body.message !== 'string' || !req.body.message.trim() || req.body.message.length > 240))) return success(res, 'Choose a valid Git action and commit message.', null, 422);
  if (!workspaceRunnerConfigured()) return success(res, 'Git operations need the isolated workspace runner.', { configured: false }, 503);
  const data = await callWorkspaceRunner(`/v1/workspaces/${access.workspace._id}/git`, { body: { action: req.body.action, message: req.body.message || '' }, timeoutMs: 30_000 });
  await recordActivity(access.workspace._id, req.user._id, 'git', '', `Git ${req.body.action}`);
  return success(res, 'Git operation completed.', data);
});

router.post('/:workspaceId/preview', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  if (!workspaceRunnerConfigured()) return success(res, 'Preview needs the isolated workspace runner.', { configured: false }, 503);
  const port = access.workspace.settings.previewPort || 3000;
  const profile = access.workspace.runtimeProfile || 'node';
  await req.app.get('io')?.flushWorkspaceFiles?.(access.workspace._id);
  const files = await WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path content').lean();
  await syncRunnerWorkspace(access.workspace._id, files, access.workspace.directories || []);
  await callWorkspaceRunner(`/v1/workspaces/${access.workspace._id}/ports`, { body: { port, profile }, timeoutMs: 120_000 });
  const forwardedPorts = access.workspace.settings.forwardedPorts || [];
  const existing = forwardedPorts.find((entry) => entry.port === port);
  if (existing) { existing.profile = profile; existing.terminalType = 'language'; }
  else forwardedPorts.push({ port, profile, terminalType: 'language' });
  access.workspace.settings.forwardedPorts = forwardedPorts;
  await access.workspace.save();
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  const previewUrl = `${protocol}://${req.get('host')}/api/workspaces/${access.workspace._id}/ports/${port}/proxy/`;
  return success(res, 'Workspace preview started.', { port, profile, forwardedPorts, previewUrl });
});

router.post('/:workspaceId/ports', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const port = Number(req.body?.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return success(res, 'Enter a port from 1024 to 65535.', null, 422);
  const terminalType = req.body?.terminalType || 'language';
  if (!terminalTypes.has(terminalType)) return success(res, 'Choose a supported terminal type for this port.', null, 422);
  const forwardedPorts = access.workspace.settings.forwardedPorts || [];
  if (!forwardedPorts.some((entry) => entry.port === port) && forwardedPorts.length >= 20) return success(res, 'A workspace can forward up to 20 ports.', null, 409);
  if (!workspaceRunnerConfigured()) return success(res, 'Port forwarding needs the isolated workspace runner.', { configured: false }, 503);
  await req.app.get('io')?.flushWorkspaceFiles?.(access.workspace._id);
  const files = await WorkspaceFile.find({ workspaceId: access.workspace._id }).select('path content').lean();
  await syncRunnerWorkspace(access.workspace._id, files, access.workspace.directories || []);
  const profile = access.workspace.runtimeProfile || 'node';
  await callWorkspaceRunner(`/v1/workspaces/${access.workspace._id}/ports`, { body: { port, profile, terminalType }, timeoutMs: 120_000 });
  const existing = forwardedPorts.find((entry) => entry.port === port);
  if (existing) { existing.profile = profile; existing.terminalType = terminalType; }
  else forwardedPorts.push({ port, profile, terminalType });
  access.workspace.settings.forwardedPorts = forwardedPorts;
  await access.workspace.save();
  return success(res, `Port ${port} forwarded.`, { port, profile, forwardedPorts });
});

router.delete('/:workspaceId/ports', authenticate, async (req, res) => {
  const access = await accessWorkspace(req.params.workspaceId, req.user._id);
  if (access.error) return success(res, access.error, null, access.status);
  if (!access.canWrite) return success(res, 'You have read-only workspace access.', null, 403);
  const port = Number(req.body?.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return success(res, 'Enter a valid forwarded port.', null, 422);
  access.workspace.settings.forwardedPorts = (access.workspace.settings.forwardedPorts || []).filter((entry) => entry.port !== port);
  await access.workspace.save();
  if (workspaceRunnerConfigured()) await callWorkspaceRunner(`/v1/workspaces/${access.workspace._id}/ports/${port}`, { method: 'DELETE', timeoutMs: 15_000 }).catch(() => {});
  return success(res, `Port ${port} closed.`, { forwardedPorts: access.workspace.settings.forwardedPorts });
});

router.use('/:workspaceId/ports/:port/proxy', authenticate, async (req, res, next) => {
  try {
    const access = await accessWorkspace(req.params.workspaceId, req.user._id);
    if (access.error) return success(res, access.error, null, access.status);
    const port = Number(req.params.port);
    const forwarded = (access.workspace.settings.forwardedPorts || []).find((entry) => entry.port === port);
    if (!forwarded) return success(res, 'Forward this port from the workspace before opening it.', null, 404);
    const url = new URL(req.originalUrl, 'http://localhost');
    const prefix = `/api/workspaces/${access.workspace._id}/ports/${port}/proxy`;
    const suffix = url.pathname.slice(prefix.length) || '/';
    const profile = forwarded.profile || access.workspace.runtimeProfile || 'node';
    const terminalType = forwarded.terminalType || 'language';
    const query = `${url.search ? `${url.search}&` : '?'}_devcollabProfile=${encodeURIComponent(profile)}&_devcollabType=${encodeURIComponent(terminalType)}`;
    return proxyWorkspaceRunnerRequest(`/v1/workspaces/${access.workspace._id}/ports/${port}/proxy${suffix}${query}`, req, res);
  } catch (error) { return next(error); }
});
export default router;
