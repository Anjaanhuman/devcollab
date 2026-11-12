import mongoose from 'mongoose';

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    console.warn('MONGODB_URI is not configured; starting the API without a database connection.');
    return false;
  }

  mongoose.connection.on('connected', () => console.info('MongoDB connected.'));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected.'));
  mongoose.connection.on('error', (error) => console.error('MongoDB connection error:', error.message));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  return true;
}
