import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const commentSchema = new Schema({
  post: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  parent: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
}, { timestamps: true });

commentSchema.index({ post: 1, createdAt: 1 });
commentSchema.index({ parent: 1, createdAt: 1 });

export default models.Comment || model('Comment', commentSchema);
