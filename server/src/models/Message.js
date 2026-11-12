import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const messageSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  conversationId: { type: String, trim: true, default: '', index: true },
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null, index: true },
  fileReference: { type: String, trim: true, maxlength: 240, default: '' },
  body: { type: String, required: true, trim: true, maxlength: 5000 },
  readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

messageSchema.index({ project: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, createdAt: -1 });

export default models.Message || model('Message', messageSchema);
