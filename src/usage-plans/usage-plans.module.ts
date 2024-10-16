import { Module } from '@nestjs/common';
import { UsagePlansService } from './usage-plans.service';
import { UsagePlansController } from './usage-plans.controller';
import { AWSService } from 'src/awsservice/awsservice.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsagePlan } from './entities/usage-plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UsagePlan])],
  providers: [UsagePlansService, AWSService],
  controllers: [UsagePlansController]
})
export class UsagePlansModule {}
