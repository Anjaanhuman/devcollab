import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const postSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 5, maxlength: 180 },
  body: { type: String, required: true, trim: true, minlength: 10, maxlength: 10000 },
  tags: { type: [String], default: [] },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  moderationStatus: { type: String, enum: ['visible', 'hidden'], default: 'visible', index: true },
}, { timestamps: true });

postSchema.index({ moderationStatus: 1, createdAt: -1 });
postSchema.index({ title: 'text', body: 'text', tags: 'text' });

export default models.Post || model('Post', postSchema);
