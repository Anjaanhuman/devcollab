import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';

const { ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_FULL_NAME, ADMIN_PASSWORD, MONGODB_URI } = process.env;

if (!MONGODB_URI || !ADMIN_EMAIL || !ADMIN_USERNAME || !ADMIN_FULL_NAME || !ADMIN_PASSWORD) {
  console.error('Set MONGODB_URI, ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_FULL_NAME, and ADMIN_PASSWORD before seeding an admin.');
  process.exitCode = 1;
} else if (Buffer.byteLength(ADMIN_PASSWORD, 'utf8') < 8 || Buffer.byteLength(ADMIN_PASSWORD, 'utf8') > 72) {
  console.error('ADMIN_PASSWORD must be 8 to 72 UTF-8 bytes.');
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(MONGODB_URI);
    const email = ADMIN_EMAIL.toLowerCase().trim();
    const username = ADMIN_USERNAME.toLowerCase().trim();
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ fullName: ADMIN_FULL_NAME.trim(), username, email, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: 'admin' });
      console.info(`Created admin account ${user.username}.`);
    } else {
      user.role = 'admin';
      user.suspendedAt = null;
      await user.save();
      console.info(`Promoted existing account ${user.username} to admin. Its password was not changed.`);
    }
  } catch (error) {
    console.error('Admin seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
