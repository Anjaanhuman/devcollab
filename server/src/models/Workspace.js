import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const editorSettingsSchema = new Schema({
  fontSize: { type: Number, min: 10, max: 30, default: 14 },
  tabSize: { type: Number, min: 2, max: 8, default: 2 },
  wordWrap: { type: String, enum: ['off', 'on', 'wordWrapColumn', 'bounded'], default: 'on' },
}, { _id: false });

const forwardedPortSchema = new Schema({
  port: { type: Number, min: 1024, max: 65535, required: true },
  profile: { type: String, trim: true, maxlength: 40, default: 'node' },
  terminalType: { type: String, enum: ['language', 'bash', 'ubuntu', 'git', 'powershell'], default: 'language' },
}, { _id: false });

const workspaceSettingsSchema = new Schema({
  editor: { type: editorSettingsSchema, default: () => ({}) },
  previewPort: { type: Number, min: 1024, max: 65535, default: 3000 },
  forwardedPorts: { type: [forwardedPortSchema], default: [] },
}, { _id: false });

const workspaceSchema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  containerId: { type: String, trim: true, default: '', select: false },
  sandboxStatus: { type: String, enum: ['stopped', 'starting', 'running', 'sleeping', 'error'], default: 'stopped', index: true },
  starterFilesStatus: { type: String, enum: ['pending', 'ready'], default: undefined, select: false },
  activeBranch: { type: String, trim: true, maxlength: 255, default: '' },
  runtimeProfile: { type: String, trim: true, maxlength: 40, default: 'node' },
  storageRootPath: { type: String, required: true, trim: true, select: false },
  directories: { type: [String], default: [] },
  settings: { type: workspaceSettingsSchema, default: () => ({}) },
}, { timestamps: true, minimize: false });

workspaceSchema.index({ projectId: 1 }, { unique: true });
workspaceSchema.index({ ownerId: 1, updatedAt: -1 });

export default models.Workspace || model('Workspace', workspaceSchema);
