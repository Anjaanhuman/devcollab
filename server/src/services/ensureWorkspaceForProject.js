import Project from '../models/Project.js';
import Workspace from '../models/Workspace.js';
import WorkspaceFile from '../models/WorkspaceFile.js';

const starterFiles = [
  { path: 'README.md', content: '# Project workspace\n\nThis is the shared workspace for your project. Add files, invite teammates, and collaborate here.\n' },
  { path: 'src/index.js', content: "console.log('Hello from your DEVCOLLAB workspace!');\n" },
  { path: 'package.json', content: '{\n  "name": "devcollab-project",\n  "private": true,\n  "scripts": {\n    "start": "node src/index.js"\n  }\n}\n' },
];

/**
 * Creates or retrieves the single workspace belonging to a project.
 * Workspace files live in MongoDB so they persist with the configured
 * database. Code execution is delegated to a separately configured runner.
 */
export async function ensureWorkspaceForProject(projectOrId) {
  const project = projectOrId?._id
    ? projectOrId
    : await Project.findById(projectOrId).select('title owner');

  if (!project) return null;

  const projectId = project._id;
  const workspaceDefaults = {
    name: `${project.title} Workspace`.slice(0, 120),
    storageRootPath: `workspaces/${projectId}`,
    sandboxStatus: 'stopped',
    starterFilesStatus: 'pending',
  };

  try {
    await Workspace.updateOne(
      { projectId },
      {
        $set: { ownerId: project.owner },
        $setOnInsert: workspaceDefaults,
      },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    const workspace = await Workspace.findOne({ projectId }).select('+starterFilesStatus');
    if (!workspace) throw new Error('Could not create the project workspace.');

    // Seed once for new workspaces. Legacy workspaces have no status and are
    // treated as initialized, so deleting every file never restores starters.
    // The pending marker lets concurrent first opens safely finish seeding.
    if (workspace.starterFilesStatus === 'pending') {
      await Promise.all(starterFiles.map((file) => WorkspaceFile.updateOne(
        { workspaceId: workspace._id, path: file.path },
        { $setOnInsert: { ...file, workspaceId: workspace._id, createdBy: project.owner, updatedBy: project.owner } },
        { upsert: true },
      ).catch((error) => {
        if (error?.code !== 11000) throw error;
      })));
      workspace.starterFilesStatus = 'ready';
      await workspace.save();
    }
    return workspace;
  } catch (error) {
    // A concurrent first-open may win the unique-index race. Retry against
    // the winning workspace so a pending starter-file seed is also completed.
    if (error?.code === 11000) return ensureWorkspaceForProject(project);
    throw error;
  }
}
