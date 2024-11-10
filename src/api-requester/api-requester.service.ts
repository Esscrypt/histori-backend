import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiRequesterService {
  private readonly logger = new Logger(ApiRequesterService.name);

  constructor(private configService: ConfigService) {}

  // Schedule the cron job to run every 5 minutes
  // This is meant to keep the AWS Lambda function warm. Cost is approximately 0.36$ a month
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron() {
    this.logger.debug('Fetching ERC-20 token data...');

    try {
      const apiKey = this.configService.get<string>('HISTORI_API_KEY'); // Fetch API key from .env
      const baseUrl = this.configService.get<string>('HISTORI_API_BASE_URL'); // Fetch API base URL from .env
      await axios.get(`${baseUrl}/tokens?token_type=erc20`, {
        headers: {
          'x-api-key': apiKey, // Set the x-api-key header
        },
      });

      // Log the response or process it as needed
      // this.logger.debug('Token Data:', response.data);
      this.logger.debug('Lambda keep warm request made successfully!');
    } catch (error) {
      this.logger.error('Error fetching token data:', error.message);
    }
  }
}
