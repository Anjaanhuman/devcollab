import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const notificationSchema = new Schema({
  recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: ['join_request', 'request_approved', 'request_rejected', 'project_invite', 'task_assigned', 'task_updated', 'message', 'post_reply'], required: true },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  task: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  post: { type: Schema.Types.ObjectId, ref: 'Post', default: null },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

export default models.Notification || model('Notification', notificationSchema);
