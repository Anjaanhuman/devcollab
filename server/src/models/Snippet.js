import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const snippetSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  code: { type: String, required: true, maxlength: 100000 },
  language: { type: String, trim: true, maxlength: 40, default: 'javascript' },
  tags: { type: [String], default: [] },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: true });

snippetSchema.index({ visibility: 1, createdAt: -1 });
snippetSchema.index({ title: 'text', description: 'text', tags: 'text' });

export default models.Snippet || model('Snippet', snippetSchema);
