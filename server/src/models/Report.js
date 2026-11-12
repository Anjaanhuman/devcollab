import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const reportSchema = new Schema({
  targetType: { type: String, enum: ['Project', 'Post', 'Snippet'], required: true },
  target: { type: Schema.Types.ObjectId, required: true, refPath: 'targetType' },
  reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, target: 1, reporter: 1 }, { unique: true });

export default models.Report || model('Report', reportSchema);
