import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/auth/entities/user.entity';
import moment from 'moment';
import { MailService } from './mail.service';
import { AWSService } from 'src/awsservice/awsservice.service';

@Injectable()
export class TrialMonitorService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly awsService: AWSService,
  ) {}

  // Run daily
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkTrialPeriod() {
    const users = await this.userRepository.find();

    for (const user of users) {
      const accountAge = moment().diff(moment(user.createdAt), 'days');

      // If account is 21 days old and still on Free tier, set request limit to 0
      if (user.tier === 'Free' && accountAge >= 21) {
        await this.awsService.removeApiKeyTierAssociation(
          user.apiKeyId,
          user.tier,
        );
        user.tier = 'None';
        user.requestLimit = 0;
        await this.userRepository.save(user);
        console.log(
          `User ${user.email} has been downgraded to request limit 0 due to trial expiration.`,
        );
      }

      // If account is 14 days old, send notification email about trial ending soon
      if (user.tier === 'Free' && accountAge === 14) {
        await this.mailService.sendTrialEndingEmail(user.email);
        console.log(`Trial ending email sent to user: ${user.email}`);
      }
    }
  }
}
