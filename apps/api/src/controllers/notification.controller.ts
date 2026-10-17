import type { RequestHandler } from 'express';
import { notificationIdParamsSchema } from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import type { NotificationService } from '#src/services/notification.service';

export function createNotificationController(notifications: NotificationService) {
  const list: RequestHandler = async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await notifications.list(authOf(res).userId));
  };

  const markRead: RequestHandler = async (req, res) => {
    const { notificationId } = notificationIdParamsSchema.parse(req.params);
    await notifications.markRead(authOf(res).userId, notificationId);
    res.status(204).end();
  };

  const markAllRead: RequestHandler = async (_req, res) => {
    await notifications.markAllRead(authOf(res).userId);
    res.status(204).end();
  };

  return { list, markRead, markAllRead };
}
