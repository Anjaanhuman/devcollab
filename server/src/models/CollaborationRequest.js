import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const requestSchema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  requester: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  message: { type: String, trim: true, maxlength: 1000, default: '' },
  respondedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  respondedAt: { type: Date, default: null },
}, { timestamps: true });

requestSchema.index({ project: 1, status: 1, createdAt: -1 });
requestSchema.index({ requester: 1, status: 1, createdAt: -1 });
requestSchema.index({ project: 1, requester: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

export default models.CollaborationRequest || model('CollaborationRequest', requestSchema);
