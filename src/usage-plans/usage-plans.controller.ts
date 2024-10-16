// usage-plans/usage-plans.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UsagePlansService } from './usage-plans.service';
import { UsagePlanDto } from './dtos/ussage-plan.dto';

@ApiTags('Usage Plans')
@Controller('usage-plans')
export class UsagePlansController {
  constructor(private readonly usagePlansService: UsagePlansService) {}

  @Get()
  @ApiOperation({ summary: 'Get all usage plans' })
  @ApiResponse({ status: 200, description: 'List of usage plans', type: [UsagePlanDto] })
  async getUsagePlans(): Promise<UsagePlanDto[]> {
    return this.usagePlansService.getUsagePlans();
  }
}
