// usage-plans/dto/usage-plan.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class UsagePlanDto {
  @ApiProperty({ description: 'The name of the usage plan' })
  name: string;

  @ApiProperty({
    description: 'The description of the usage plan (If there is one)',
  })
  description?: string;

  @ApiProperty({
    description: 'The Stripe lookup-key for monthly subscription',
  })
  stripeLookupKeyMonthly: string;

  @ApiProperty({
    description: 'The Stripe lookup-key for yearly subscription',
  })
  stripeLookupKeyYearly: string;

  @ApiProperty({ description: 'The monthly price of the usage plan' })
  priceMonthly: number;

  @ApiProperty({
    description:
      'The monthly price of the usage plan if pre-paid on a yearly basis',
  })
  priceYearly: number;

  @ApiProperty({ description: 'The number of requests allowed per month' })
  requestsPerMonth?: number;

  @ApiProperty({ description: 'The rate limit in requests per second' })
  requestsPerSecond?: number;

  @ApiProperty({ description: 'The burst limit in requests per second' })
  burstRequestsPerSecond?: number;
}
