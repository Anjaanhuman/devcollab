import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const memberSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['Owner', 'Team Leader', 'Developer', 'Contributor'], default: 'Developer' },
  workspaceRole: { type: String, enum: ['editor', 'viewer'], default: 'editor' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const projectSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  description: { type: String, required: true, trim: true, minlength: 20, maxlength: 5000 },
  category: { type: String, trim: true, maxlength: 60, default: 'General' },
  requiredSkills: { type: [String], default: [] },
  techStack: { type: [String], default: [] },
  difficulty: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
  maxTeamSize: { type: Number, min: 1, max: 50, default: 5 },
  deadline: { type: Date, default: null },
  githubRepo: { type: String, trim: true, maxlength: 300, default: '' },
  visibility: { type: String, enum: ['public', 'private'], default: 'public', index: true },
  status: { type: String, enum: ['Planning', 'Active', 'Completed', 'Archived'], default: 'Planning', index: true },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  members: { type: [memberSchema], default: [] },
  moderationStatus: { type: String, enum: ['visible', 'hidden'], default: 'visible', index: true },
}, { timestamps: true });

projectSchema.index({ visibility: 1, status: 1, createdAt: -1 });
projectSchema.index({ owner: 1, createdAt: -1 });
projectSchema.index({ 'members.user': 1, updatedAt: -1 });
projectSchema.index({ title: 'text', description: 'text', requiredSkills: 'text', techStack: 'text' });

export default models.Project || model('Project', projectSchema);
