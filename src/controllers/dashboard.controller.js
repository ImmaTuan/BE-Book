import { dashboardRange } from '../dashboard-periods.js';
import { getDashboard } from '../models/dashboard.model.js';

export async function showDashboard(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await getDashboard(dashboardRange(req.query)) });
}
