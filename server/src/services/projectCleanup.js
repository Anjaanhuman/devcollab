import CollaborationRequest from '../models/CollaborationRequest.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import Task from '../models/Task.js';
import Workspace from '../models/Workspace.js';
import WorkspaceActivity from '../models/WorkspaceActivity.js';
import WorkspaceFile from '../models/WorkspaceFile.js';

export async function cleanupProject(projectId) {
  await Promise.all([
    CollaborationRequest.deleteMany({ project: projectId }),
    Message.deleteMany({ project: projectId }),
    Notification.deleteMany({ project: projectId }),
    Task.deleteMany({ project: projectId }),
    (async () => {
      const workspaces = await Workspace.find({ projectId }).select('_id');
      const workspaceIds = workspaces.map((workspace) => workspace._id);
      await Promise.all([
        Workspace.deleteMany({ projectId }),
        WorkspaceFile.deleteMany({ workspaceId: { $in: workspaceIds } }),
        WorkspaceActivity.deleteMany({ workspaceId: { $in: workspaceIds } }),
      ]);
    })(),
  ]);
}
