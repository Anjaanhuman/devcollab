import Notification from '../models/Notification.js';

export async function createNotification(req, { recipient, actor = null, type, message, project = null, task = null, post = null }) {
  if (!recipient || String(recipient) === String(actor)) return null;
  const notification = await Notification.create({ recipient, actor, type, message, project, task, post });
  const io = req.app.get('io');
  io?.to(`user:${recipient}`).emit('notification:new', notification);
  return notification;
}
