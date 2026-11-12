import { Server } from 'socket.io';
import mongoose from 'mongoose';
import Message from './models/Message.js';
import Notification from './models/Notification.js';
import Project from './models/Project.js';
import User from './models/User.js';
import Workspace from './models/Workspace.js';
import WorkspaceFile from './models/WorkspaceFile.js';
import WorkspaceActivity from './models/WorkspaceActivity.js';
import { syncRunnerFile } from './services/workspaceRunner.js';
import * as Y from 'yjs';
import { verifyToken, COOKIE_NAME } from './utils/tokens.js';
import { isProjectMember } from './utils/projectAccess.js';
import { conversationKey } from './routes/messageRoutes.js';
import { isValidObjectId } from './utils/api.js';

function cookieValue(header, name) {
  const prefix = `${name}=`;
  return String(header || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

const MAX_WORKSPACE_FILE_BYTES = 1_048_576;
const MAX_WORKSPACE_TOTAL_BYTES = 52_428_800;
const MAX_YJS_STATE_BYTES = 8_388_608;

export function attachSocketServer(httpServer, allowedOrigins) {
  const io = new Server(httpServer, { cors: { origin: allowedOrigins, credentials: true }, maxHttpBufferSize: 1e6 });
  const onlineCounts = new Map();
  const workspaceDocs = new Map();
  const lastCursorAt = new Map();

  async function workspaceAccess(workspaceId, userId) {
    if (!isValidObjectId(workspaceId)) return null;
    const workspace = await Workspace.findById(workspaceId).select('projectId');
    if (!workspace) return null;
    const project = await Project.findById(workspace.projectId).select('owner members moderationStatus');
    if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, userId)) return null;
    const member = project.members.find((entry) => String(entry.user) === String(userId));
    const role = String(project.owner) === String(userId) ? 'owner' : member?.workspaceRole || 'editor';
    return { workspace, project, canWrite: role !== 'viewer' };
  }

  async function collaborativeDoc(workspaceId, path) {
    const key = `${workspaceId}:${path}`;
    if (workspaceDocs.has(key)) return workspaceDocs.get(key);
    const file = await WorkspaceFile.findOne({ workspaceId, path }).select('+collaborationState');
    if (!file) return null;
    const doc = new Y.Doc();
    if (file.collaborationState?.length) Y.applyUpdate(doc, file.collaborationState);
    else if (file.content) doc.getText('monaco').insert(0, file.content);
    const state = { key, doc, workspaceId, path, timer: null };
    doc.on('update', () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(async () => {
        state.timer = null;
        const currentFile = await WorkspaceFile.findOne({ workspaceId, path }).select('_id');
        if (!currentFile) return;
        const content = doc.getText('monaco').toString();
        const contentBytes = Buffer.byteLength(content, 'utf8');
        if (contentBytes > MAX_WORKSPACE_FILE_BYTES) {
          const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
          io.to(room).emit('workspace:file:limit', { path, message: 'A workspace file cannot exceed 1 MB. Reload to discard unsaved changes.' });
          return;
        }
        const otherUsage = await WorkspaceFile.aggregate([
          { $match: { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), _id: { $ne: currentFile._id } } },
          { $group: { _id: null, total: { $sum: { $strLenBytes: '$content' } } } },
        ]);
        if ((otherUsage[0]?.total || 0) + contentBytes > MAX_WORKSPACE_TOTAL_BYTES) {
          const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
          io.to(room).emit('workspace:file:limit', { path, message: 'This workspace has reached its 50 MB limit. Delete files before saving more content.' });
          return;
        }
        const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
        if (snapshot.length > MAX_YJS_STATE_BYTES) {
          const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
          io.to(room).emit('workspace:file:limit', { path, message: 'Collaboration history for this file is too large to save. Reload the file and continue.' });
          return;
        }
        const result = await WorkspaceFile.updateOne({ _id: currentFile._id }, {
          $set: { content, collaborationState: snapshot },
          $inc: { version: 1 },
        }).catch((error) => { console.error('Could not persist collaborative workspace changes.', error.message); return null; });
        if (result?.modifiedCount) {
          await syncRunnerFile(workspaceId, path, content).catch((error) => console.error('Could not sync a workspace file with the runner.', error.message));
          const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
          io.to(room).emit('workspace:file:persisted', { path });
        }
      }, 350);
    });
    workspaceDocs.set(key, state);
    return state;
  }

  io.invalidateWorkspaceFile = (workspaceId, path) => {
    const key = `${workspaceId}:${path}`;
    const state = workspaceDocs.get(key);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.doc.destroy();
    workspaceDocs.delete(key);
  };

  io.flushWorkspaceFile = async (workspaceId, path) => {
    const state = workspaceDocs.get(String(workspaceId) + ':' + path);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    const content = state.doc.getText('monaco').toString();
    if (Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_FILE_BYTES) throw new Error('This file is too large to move. Save it below the 1 MB limit first.');
    const file = await WorkspaceFile.findOne({ workspaceId, path }).select('+collaborationState');
    if (!file) throw new Error('The file could not be found while saving it for the move.');
    const otherUsage = await WorkspaceFile.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), _id: { $ne: file._id } } },
      { $group: { _id: null, total: { $sum: { $strLenBytes: '$content' } } } },
    ]);
    if ((otherUsage[0]?.total || 0) + Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_TOTAL_BYTES) throw new Error('This workspace has reached its 50 MB limit.');
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(state.doc));
    if (snapshot.length > MAX_YJS_STATE_BYTES) throw new Error('Collaboration history for this file is too large to save.');
    await WorkspaceFile.updateOne({ _id: file._id }, {
      $set: { content, collaborationState: snapshot },
      $inc: { version: 1 },
    });
    await syncRunnerFile(workspaceId, path, content).catch((error) => console.error('Could not sync a workspace file with the runner.', error.message));
    io.to('workspace-file:' + workspaceId + ':' + Buffer.from(path).toString('base64url')).emit('workspace:file:persisted', { path });
  };

  io.isWorkspaceFileActive = async (workspaceId, path) => {
    const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
    return (await io.in(room).allSockets()).size > 0;
  };

  io.invalidateWorkspace = (workspaceId) => {
    const prefix = `${workspaceId}:`;
    for (const [key, state] of workspaceDocs) {
      if (!key.startsWith(prefix)) continue;
      if (state.timer) clearTimeout(state.timer);
      state.doc.destroy();
      workspaceDocs.delete(key);
    }
  };

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || cookieValue(socket.handshake.headers.cookie, COOKIE_NAME);
      if (!token) return next(new Error('Authentication required.'));
      const claims = verifyToken(token);
      const user = await User.findById(claims.sub).select('_id role suspendedAt fullName username +sessionVersion');
      if (!user || user.suspendedAt || claims.ver !== user.sessionVersion) return next(new Error('Unauthorized.'));
      socket.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.user._id);
    socket.join(`user:${userId}`);
    onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
    io.emit('presence:update', { userId, online: true });

    socket.on('chat:project:join', async ({ projectId } = {}, acknowledge = () => {}) => {
      try {
        if (!isValidObjectId(projectId)) return acknowledge({ success: false, message: 'Invalid project.' });
        const project = await Project.findById(projectId).select('owner members moderationStatus');
        if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, userId)) return acknowledge({ success: false, message: 'Project access denied.' });
        await socket.join(`project:${projectId}`);
        return acknowledge({ success: true });
      } catch {
        return acknowledge({ success: false, message: 'Could not join project channel.' });
      }
    });

    socket.on('workspace:join', async ({ projectId } = {}, acknowledge = () => {}) => {
      try {
        if (!isValidObjectId(projectId)) return acknowledge({ success: false, message: 'Invalid project.' });
        const project = await Project.findById(projectId).select('title owner members moderationStatus');
        if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, userId)) return acknowledge({ success: false, message: 'Workspace access denied.' });
        const { ensureWorkspaceForProject } = await import('./services/ensureWorkspaceForProject.js');
        const workspace = await ensureWorkspaceForProject(project);
        await socket.join(`workspace:${workspace._id}`);
        const member = project.members.find((entry) => String(entry.user) === userId);
        const role = String(project.owner) === userId ? 'owner' : member?.workspaceRole || 'editor';
        io.to(`workspace:${workspace._id}`).emit('workspace:presence', { userId, username: socket.user.username, fullName: socket.user.fullName, online: true });
        return acknowledge({ success: true, data: { workspaceId: String(workspace._id), projectId: String(project._id), canWrite: role !== 'viewer' } });
      } catch {
        return acknowledge({ success: false, message: 'Could not open the project workspace.' });
      }
    });

    socket.on('workspace:file:join', async ({ workspaceId, path } = {}, acknowledge = () => {}) => {
      try {
        const safePath = typeof path === 'string' && path.length <= 240 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..') ? path : '';
        const access = await workspaceAccess(workspaceId, userId);
        if (!access || !safePath) return acknowledge({ success: false, message: 'File access denied.' });
        const state = await collaborativeDoc(workspaceId, safePath);
        if (!state) return acknowledge({ success: false, message: 'Workspace file not found.' });
        const room = `workspace-file:${workspaceId}:${Buffer.from(safePath).toString('base64url')}`;
        await socket.join(room);
        return acknowledge({ success: true, data: { path: safePath, state: Buffer.from(Y.encodeStateAsUpdate(state.doc)).toString('base64'), vector: Buffer.from(Y.encodeStateVector(state.doc)).toString('base64') } });
      } catch {
        return acknowledge({ success: false, message: 'Could not sync this workspace file.' });
      }
    });

    socket.on('workspace:file:save', async ({ workspaceId, path } = {}, acknowledge = () => {}) => {
      try {
        const validPath = typeof path === 'string' && path.length <= 240 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..');
        const access = await workspaceAccess(workspaceId, userId);
        if (!access || !access.canWrite || !validPath) return acknowledge({ success: false, message: 'File save access denied.' });
        const room = 'workspace-file:' + workspaceId + ':' + Buffer.from(path).toString('base64url');
        if (!socket.rooms.has(room) || !(await WorkspaceFile.exists({ workspaceId, path }))) return acknowledge({ success: false, message: 'Open a workspace file before saving it.' });
        await io.flushWorkspaceFile(workspaceId, path);
        return acknowledge({ success: true, data: { path } });
      } catch (error) {
        return acknowledge({ success: false, message: error.message || 'The workspace file could not be saved.' });
      }
    });

    socket.on('workspace:file:leave', async ({ workspaceId, path } = {}, acknowledge = () => {}) => {
      try {
        const validPath = typeof path === 'string' && path.length <= 240 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..');
        const access = await workspaceAccess(workspaceId, userId);
        if (!access || !validPath) return acknowledge({ success: false, message: 'File access denied.' });
        await io.flushWorkspaceFile(workspaceId, path);
        await socket.leave('workspace-file:' + workspaceId + ':' + Buffer.from(path).toString('base64url'));
        return acknowledge({ success: true });
      } catch (error) {
        return acknowledge({ success: false, message: error.message || 'Could not save this file before closing it.' });
      }
    });

    socket.on('workspace:file:update', async ({ workspaceId, path, update } = {}, acknowledge = () => {}) => {
      try {
        const access = await workspaceAccess(workspaceId, userId);
        const validPath = typeof path === 'string' && path.length <= 240 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..');
        if (!access || !access.canWrite || !validPath || typeof update !== 'string' || update.length > 180_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(update)) return acknowledge({ success: false, message: 'Workspace update rejected.' });
        const decoded = Buffer.from(update, 'base64');
        if (!decoded.length || decoded.length > 128_000) return acknowledge({ success: false, message: 'Workspace update is too large.' });
        const state = await collaborativeDoc(workspaceId, path);
        if (!state) return acknowledge({ success: false, message: 'Workspace file not found.' });
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(state.doc));
          Y.applyUpdate(candidate, decoded);
          if (Buffer.byteLength(candidate.getText('monaco').toString(), 'utf8') > MAX_WORKSPACE_FILE_BYTES) return acknowledge({ success: false, message: 'Workspace files are limited to 1 MB. Reload the file to discard the unsaved change.' });
        } finally { candidate.destroy(); }
        Y.applyUpdate(state.doc, decoded, socket.id);
        const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
        socket.to(room).emit('workspace:file:update', { workspaceId, path, update });
        return acknowledge({ success: true });
      } catch {
        return acknowledge({ success: false, message: 'Workspace update could not be applied.' });
      }
    });

    socket.on('workspace:file:cursor', async ({ workspaceId, path, position } = {}) => {
      try {
        const access = await workspaceAccess(workspaceId, userId);
        if (!access || typeof path !== 'string' || path.length > 240 || path.includes('\\') || path.includes('\0') || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || !position || !Number.isInteger(position.lineNumber) || !Number.isInteger(position.column) || position.lineNumber < 1 || position.column < 1 || position.lineNumber > 10_000 || position.column > 10_000) return;
        const key = `${socket.id}:${workspaceId}:${path}`;
        if (Date.now() - (lastCursorAt.get(key) || 0) < 70) return;
        if (!(await WorkspaceFile.exists({ workspaceId, path }))) return;
        lastCursorAt.set(key, Date.now());
        const room = `workspace-file:${workspaceId}:${Buffer.from(path).toString('base64url')}`;
        socket.to(room).emit('workspace:file:cursor', { userId, username: socket.user.username, path, position: { lineNumber: position.lineNumber, column: position.column } });
      } catch { /* Ignore stale cursor events. */ }
    });

    socket.on('chat:project:send', async ({ projectId, body, workspaceId, fileReference } = {}, acknowledge = () => {}) => {
      try {
        const text = typeof body === 'string' ? body.trim() : '';
        if (!isValidObjectId(projectId) || !text || text.length > 5000) return acknowledge({ success: false, message: 'Enter a message up to 5,000 characters.' });
        const project = await Project.findById(projectId).select('owner members title moderationStatus');
        if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, userId)) return acknowledge({ success: false, message: 'Project access denied.' });
        let workspace = null;
        let linkedFilePath = '';
        if (workspaceId) {
          workspace = await Workspace.findOne({ _id: workspaceId, projectId: project._id }).select('_id');
          if (!workspace) return acknowledge({ success: false, message: 'Workspace reference is invalid.' });
          if (fileReference) {
            linkedFilePath = typeof fileReference === 'string' && fileReference.length <= 240 && !fileReference.includes('\\') && !fileReference.includes('\0') && !fileReference.startsWith('/') && !fileReference.split('/').some((part) => !part || part === '.' || part === '..') ? fileReference : '';
            if (!linkedFilePath || !(await WorkspaceFile.exists({ workspaceId: workspace._id, path: linkedFilePath }))) return acknowledge({ success: false, message: 'File reference is invalid.' });
          }
        }
        const message = await Message.create({ project: projectId, workspaceId: workspace?._id || null, fileReference: linkedFilePath, sender: socket.user._id, body: text, readBy: [socket.user._id] });
        await message.populate('sender', 'username fullName avatarUrl');
        io.to(`project:${projectId}`).emit('chat:project:message', message);
        if (workspace) await WorkspaceActivity.create({ workspaceId: workspace._id, userId: socket.user._id, type: 'chat', path: linkedFilePath, summary: linkedFilePath ? `Discussed ${linkedFilePath}` : 'Sent a workspace message.' }).catch(() => {});
        const recipients = [...new Set([String(project.owner), ...project.members.map((member) => String(member.user))])].filter((id) => id !== userId);
        try {
          const alerts = await Notification.insertMany(recipients.map((recipient) => ({ recipient, actor: socket.user._id, type: 'message', project: project._id, message: `${socket.user.fullName} sent a message in ${project.title}.` })));
          alerts.forEach((alert) => io.to(`user:${alert.recipient}`).emit('notification:new', alert));
        } catch (error) { console.error('Could not persist project message notifications.', error.message); }
        return acknowledge({ success: true, data: message });
      } catch {
        return acknowledge({ success: false, message: 'Message could not be sent.' });
      }
    });

    socket.on('chat:direct:send', async ({ recipientId, body } = {}, acknowledge = () => {}) => {
      try {
        const text = typeof body === 'string' ? body.trim() : '';
        if (!isValidObjectId(recipientId) || recipientId === userId || !text || text.length > 5000) return acknowledge({ success: false, message: 'Enter a valid recipient and message.' });
        const recipient = await User.findOne({ _id: recipientId, suspendedAt: null }).select('_id');
        if (!recipient) return acknowledge({ success: false, message: 'Recipient not found.' });
        const message = await Message.create({ conversationId: conversationKey(userId, recipientId), sender: socket.user._id, recipient: recipientId, body: text, readBy: [socket.user._id] });
        await message.populate('sender', 'username fullName avatarUrl');
        io.to(`user:${userId}`).to(`user:${recipientId}`).emit('chat:direct:message', message);
        try {
          const notification = await Notification.create({ recipient: recipientId, actor: socket.user._id, type: 'message', message: `${socket.user.fullName} sent you a message.` });
          io.to(`user:${recipientId}`).emit('notification:new', notification);
        } catch (error) { console.error('Could not persist direct message notification.', error.message); }
        return acknowledge({ success: true, data: message });
      } catch {
        return acknowledge({ success: false, message: 'Message could not be sent.' });
      }
    });

    socket.on('chat:message:read', async ({ messageId } = {}, acknowledge = () => {}) => {
      try {
        if (!isValidObjectId(messageId)) return acknowledge({ success: false });
        const message = await Message.findById(messageId);
        if (!message) return acknowledge({ success: false });
        if (message.project) {
          const project = await Project.findById(message.project).select('owner members moderationStatus');
          if (!project || project.moderationStatus !== 'visible' || !isProjectMember(project, userId)) return acknowledge({ success: false });
        } else if (String(message.recipient) !== userId && String(message.sender) !== userId) return acknowledge({ success: false });
        message.readBy.addToSet(socket.user._id);
        await message.save();
        return acknowledge({ success: true });
      } catch {
        return acknowledge({ success: false });
      }
    });

    socket.on('disconnecting', () => {
      if (Math.max(0, (onlineCounts.get(userId) || 1) - 1) > 0) return;
      for (const room of socket.rooms) if (room.startsWith('workspace:')) io.to(room).emit('workspace:presence', { userId, username: socket.user.username, online: false });
    });

    socket.on('disconnect', async () => {
      for (const key of lastCursorAt.keys()) if (key.startsWith(`${socket.id}:`)) lastCursorAt.delete(key);
      const count = Math.max(0, (onlineCounts.get(userId) || 1) - 1);
      if (count) onlineCounts.set(userId, count);
      else {
        onlineCounts.delete(userId);
        io.emit('presence:update', { userId, online: false });
        await User.updateOne({ _id: socket.user._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
      }
    });
  });

  return io;
}
