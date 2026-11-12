import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const workspaceFileSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  path: { type: String, required: true, trim: true, maxlength: 240 },
  content: { type: String, default: '', maxlength: 1_048_576 },
  collaborationState: { type: Buffer, default: undefined, select: false },
  version: { type: Number, default: 1, min: 1 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

workspaceFileSchema.index({ workspaceId: 1, path: 1 }, { unique: true });
workspaceFileSchema.index({ workspaceId: 1, updatedAt: -1 });

export default models.WorkspaceFile || model('WorkspaceFile', workspaceFileSchema);
