import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const workspaceActivitySchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['file_created', 'file_renamed', 'file_deleted', 'file_saved', 'file_moved', 'terminal', 'git', 'chat'], required: true },
  path: { type: String, trim: true, maxlength: 240, default: '' },
  summary: { type: String, trim: true, maxlength: 240, default: '' },
}, { timestamps: true });

workspaceActivitySchema.index({ workspaceId: 1, createdAt: -1 });
workspaceActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default models.WorkspaceActivity || model('WorkspaceActivity', workspaceActivitySchema);
