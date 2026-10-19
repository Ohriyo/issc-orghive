import { Router } from 'express';
import { createDashboardController } from '#src/controllers/dashboard.controller';
import { createNotificationController } from '#src/controllers/notification.controller';
import { requireAuth } from '#src/middleware/require-auth';
import type { DashboardService } from '#src/services/dashboard.service';
import type { NotificationService } from '#src/services/notification.service';
import type { TokenService } from '#src/services/token.service';

export interface MeRouterDeps {
  dashboard: DashboardService;
  notifications: NotificationService;
  tokens: Pick<TokenService, 'verify'>;
}

/** The signed-in user's own data. Everything here needs a session. */
export function meRouter({ dashboard, notifications, tokens }: MeRouterDeps): Router {
  const router = Router();
  const controller = createDashboardController(dashboard);
  const notificationController = createNotificationController(notifications);
  const auth = requireAuth(tokens);

  router.get('/dashboard', auth, controller.get);
  router.get('/notifications', auth, notificationController.list);
  router.post('/notifications/read-all', auth, notificationController.markAllRead);
  router.post('/notifications/:notificationId/read', auth, notificationController.markRead);
  router.get('/notification-preferences', auth, notificationController.preferences);
  router.put('/notification-preferences', auth, notificationController.updatePreferences);

  return router;
}
