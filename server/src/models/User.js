import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const socialLinksSchema = new Schema({
  github: { type: String, trim: true, maxlength: 300, default: '' },
  linkedin: { type: String, trim: true, maxlength: 300, default: '' },
  portfolio: { type: String, trim: true, maxlength: 300, default: '' },
}, { _id: false });

const userSchema = new Schema({
  fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  username: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 30, match: /^[a-z0-9_]+$/ },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  avatarUrl: { type: String, trim: true, maxlength: 1000, default: '' },
  avatarPublicId: { type: String, trim: true, maxlength: 300, default: '', select: false },
  bio: { type: String, trim: true, maxlength: 500, default: '' },
  skills: { type: [String], default: [] },
  languages: { type: [String], default: [] },
  techStack: { type: [String], default: [] },
  experienceLevel: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
  socialLinks: { type: socialLinksSchema, default: () => ({}) },
  role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  suspendedAt: { type: Date, default: null },
  sessionVersion: { type: Number, default: 0, select: false },
  passwordResetHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ fullName: 'text', username: 'text', skills: 'text' });

export default models.User || model('User', userSchema);
