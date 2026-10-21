import { Router } from 'express';
import { createDashboardController } from '#src/controllers/dashboard.controller';
import { createNotificationController } from '#src/controllers/notification.controller';
import { createRevealController } from '#src/controllers/reveal.controller';
import { requireAuth } from '#src/middleware/require-auth';
import type { DashboardService } from '#src/services/dashboard.service';
import type { MyStandingService } from '#src/services/my-standing.service';
import type { NotificationService } from '#src/services/notification.service';
import type { RevealService } from '#src/services/reveal.service';
import type { TokenService } from '#src/services/token.service';

export interface MeRouterDeps {
  dashboard: DashboardService;
  /** The account's own leaderboard standing (its dashboard card). */
  standing: Pick<MyStandingService, 'forUser'>;
  notifications: NotificationService;
  reveals: RevealService;
  tokens: Pick<TokenService, 'verify'>;
}

/** The signed-in user's own data. Everything here needs a session. */
export function meRouter({
  dashboard,
  standing,
  notifications,
  reveals,
  tokens,
}: MeRouterDeps): Router {
  const router = Router();
  const controller = createDashboardController(dashboard, standing);
  const notificationController = createNotificationController(notifications);
  const revealController = createRevealController(reveals);
  const auth = requireAuth(tokens);

  router.get('/dashboard', auth, controller.get);
  router.get('/leaderboard', auth, controller.leaderboard);
  router.get('/notifications', auth, notificationController.list);
  router.post('/notifications/read-all', auth, notificationController.markAllRead);
  router.post('/notifications/:notificationId/read', auth, notificationController.markRead);
  router.get('/notification-preferences', auth, notificationController.preferences);
  router.put('/notification-preferences', auth, notificationController.updatePreferences);
  // A one-time Reveal of temporary passwords: its recipient only, never cached.
  router.get('/reveals/:revealId', auth, revealController.status);
  router.post('/reveals/:revealId/reveal', auth, revealController.reveal);

  return router;
}
