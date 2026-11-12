import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const taskSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 3000, default: '' },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
  status: { type: String, enum: ['To Do', 'In Progress', 'In Review', 'Completed'], default: 'To Do' },
  deadline: { type: Date, default: null },
  linkedFilePath: { type: String, trim: true, maxlength: 240, default: '' },
}, { timestamps: true });

taskSchema.index({ project: 1, status: 1, createdAt: 1 });
taskSchema.index({ project: 1, assignedTo: 1, priority: 1 });

export default models.Task || model('Task', taskSchema);
