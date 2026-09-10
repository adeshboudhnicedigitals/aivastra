// Called by the web app right after login (see ProfileGate) to force-check
// and (re)send the unlimited-plan expiry reminder immediately, and to tell
// the frontend whether to show a popup. See checkUnlimitedPlanReminderOnLogin
// for the "every login, no throttling yet" caveat — this route is a thin
// wrapper around it.
import type { FastifyInstance } from 'fastify';
import { checkUnlimitedPlanReminderOnLogin } from './unlimited-plan-scheduler.js';

export async function unlimitedPlanLoginCheckRoutes(app: FastifyInstance) {
  app.post('/v1/unlimited-plan/login-check', { preHandler: app.requireUser }, async (req) => {
    return checkUnlimitedPlanReminderOnLogin(app, req.userId);
  });
}
