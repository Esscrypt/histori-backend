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

  private readonly usagePlanMapping: Record<string, string> = {
    '3r3phz': 'Free',      // Free tier usage plan ID
    'czyd8s': 'Starter',   // Starter tier usage plan ID
    'rwpes6': 'Growth',    // Growth tier usage plan ID
    'wtdvwl': 'Business',  // Business tier usage plan ID
  };

  private readonly productMapping: Record<string, string> = {
    Starter: 'prod_Qm8v7qrPXe57FY',
    Growth: 'prod_Qs8muZH1YGmilO',
    Business: 'prod_Qs8nm4g18RXJmY',
  };

  private readonly priceMonthlyMapping: Record<string, number> = {
    Free: 0,
    Starter: 50,
    Growth: 200,
    Business: 400,
  };

  private readonly priceYearlyMapping: Record<string, number> = {
    Free: 0,
    Starter: 45,
    Growth: 180,
    Business: 360,
  };

  async getUsagePlans(): Promise<UsagePlanDto[]> {
    // Check if usage plans are available in the database
    const existingUsagePlans = await this.usagePlanRepository.find();
    
    if (existingUsagePlans.length > 0) {
      // If usage plans are found in the database, return them mapped to DTOs
      return existingUsagePlans.map(plan => ({
        name: plan.name,
        description: plan.description,
        stripeProductId: plan.stripeProductId,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        requestsPerMonth: plan.requestsPerMonth,
        requestsPerSecond: plan.requestsPerSecond,
        burstRequestsPerSecond: plan.burstRequestsPerSecond,
      }));
    }

    // If no usage plans are found in the database, fetch from AWS
    const awsUsagePlans = await this.awsService.getUsagePlans();

    // Map the AWS response to the UsagePlan entity and save to the database
    const usagePlans = awsUsagePlans.map((plan: any) => {
      const tierName = this.usagePlanMapping[plan.id];
      const productId = this.productMapping[tierName];
      const priceMonthly = this.priceMonthlyMapping[tierName];
      const priceYearly = this.priceYearlyMapping[tierName];

      return this.usagePlanRepository.create({
        name: plan.name,
        description: plan.description,
        stripeProductId: productId || null,
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
    return usagePlans.map(plan => ({
      name: plan.name,
      description: plan.description,
      stripeProductId: plan.stripeProductId,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      requestsPerMonth: plan.requestsPerMonth,
      requestsPerSecond: plan.requestsPerSecond,
      burstRequestsPerSecond: plan.burstRequestsPerSecond,
    }));
  }
}
