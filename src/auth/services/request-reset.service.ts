import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/auth/entities/user.entity';
import { Repository } from 'typeorm';

@Injectable()
export class RequestResetService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // Reset request counts on the first day of every month
  @Cron('0 0 1 * *') // At midnight on the 1st of every month
  async resetRequestCounts() {
    const users = await this.userRepository.find();

    for (const user of users) {
      // Reset request count to 0
      user.requestCount = 0;

      // Set requestLimit based on the user's subscription tier
      this.setRequestLimitForTier(user);

      // Save the user with updated requestCount and requestLimit
      await this.userRepository.save(user);
    }

    console.log('Request counts and limits reset for all users');
  }

  // Helper function to set request limits based on the subscription tier
  private setRequestLimitForTier(user: User): void {
    switch (user.tier) {
      case 'Free':
        user.requestLimit = 5000;
        break;
      case 'Starter':
        user.requestLimit = 50000;
        break;
      case 'Growth':
        user.requestLimit = 300000;
        break;
      case 'Business':
        user.requestLimit = 700000;
        break;
      default:
        user.requestLimit = 5000; // Default to Free tier limit if no match
        break;
    }
  }
}
