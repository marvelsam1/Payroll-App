import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentUser, RequirePermissions, SessionUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

/** Single role-aware dashboard endpoint (the UI switches on `variant`). */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.dashboardRead)
  get(@CurrentUser() s: SessionUser) {
    return this.dashboard.getDashboard(s);
  }
}
