// usage-plans/usage-plans.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AWSService } from '../awsservice/awsservice.service';
import { UsagePlan } from './entities/usage-plan.entity';
import { UsagePlanDto } from './dtos/ussage-plan.dto';

@Injectable()
export class UsagePlansService {
  constructor(
    private readonly awsService: AWSService,
    @InjectRepository(UsagePlan)
    private readonly usagePlanRepository: Repository<UsagePlan>,
  ) {}

  private readonly priceMonthlyMapping: Record<string, number> = {
    Starter: 50,
    Growth: 200,
    Business: 400,
  };

  private readonly priceYearlyMapping: Record<string, number> = {
    Starter: 45,
    Growth: 180,
    Business: 360,
  };

  async getUsagePlans(): Promise<UsagePlanDto[]> {
    // Check if usage plans are available in the database
    const existingUsagePlans = await this.usagePlanRepository.find();

    if (existingUsagePlans.length > 0) {
      // If usage plans are found in the database, return them mapped to DTOs
      return existingUsagePlans.map((plan) => {
        console.log(plan);
        const dto = {
          name: plan.name,
          description: plan.description,
          stripeLookupKeyMonthly:
            plan.name !== 'Free' ? plan.stripeLookupKeyMonthly : null,
          stripeLookupKeyYearly:
            plan.name !== 'Free' ? plan.stripeLookupKeyYearly : null,
          priceMonthly: plan.name !== 'Free' ? plan.priceMonthly : null,
          priceYearly: plan.name !== 'Free' ? plan.priceYearly : null,
          requestsPerMonth: plan.requestsPerMonth,
          requestsPerSecond: plan.requestsPerSecond,
          burstRequestsPerSecond: plan.burstRequestsPerSecond,
        };
        return dto;
      });
    }

    // If no usage plans are found in the database, fetch from AWS
    const awsUsagePlans = await this.awsService.getUsagePlans();

    // Map the AWS response to the UsagePlan entity and save to the database
    const usagePlans = awsUsagePlans
      .filter((p) => p.name !== 'Dev')
      .map((plan: any) => {
        console.log(plan);
        const priceMonthly = this.priceMonthlyMapping[plan.name];
        const priceYearly = this.priceYearlyMapping[plan.name];

        return this.usagePlanRepository.create({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          stripeLookupKeyMonthly: plan.name.toLowerCase(),
          stripeLookupKeyYearly: `${plan.name.toLowerCase()}-yearly`,
          priceMonthly,
          priceYearly,
          requestsPerMonth: plan.requestsPerMonth,
          requestsPerSecond: plan.requestsPerSecond,
          burstRequestsPerSecond: plan.burstRequestsPerSecond,
        });
      });

    // Save the fetched usage plans to the database
    await this.usagePlanRepository.save(usagePlans);

    // Return the saved usage plans mapped to DTOs
    return usagePlans.map((plan) => ({
      name: plan.name,
      description: plan.description,
      stripeLookupKeyMonthly: plan.name.toLowerCase(),
      stripeLookupKeyYearly: `${plan.name.toLowerCase()}-yearly`,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      requestsPerMonth: plan.requestsPerMonth,
      requestsPerSecond: plan.requestsPerSecond,
      burstRequestsPerSecond: plan.burstRequestsPerSecond,
    }));
  }
}
