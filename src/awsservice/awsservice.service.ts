import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from 'src/auth/entities/user.entity';
import {
  APIGatewayClient,
  CreateApiKeyCommand,
  CreateApiKeyCommandInput,
  CreateUsagePlanKeyCommand,
  CreateUsagePlanKeyCommandInput,
  DeleteApiKeyCommand,
  DeleteUsagePlanKeyCommand,
  GetUsageCommand,
  GetUsageCommandInput,
  GetUsagePlanCommand,
  GetUsagePlanCommandInput,
  GetUsagePlansCommand,
} from '@aws-sdk/client-api-gateway'; // Import v3 commands and clients
import { UsagePlan } from 'src/usage-plans/entities/usage-plan.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class AWSService {
  private readonly logger = new Logger(AWSService.name);

  apiGateway: APIGatewayClient;

  constructor(
    private configService: ConfigService,
    @InjectRepository(UsagePlan)
    private readonly usagePlanRepository: Repository<UsagePlan>,
  ) {
    this.apiGateway = new APIGatewayClient({
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY'),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_KEY'),
      },
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
    });
  }

  // Fetch information for all available usage plans by ID
  async getUsagePlans() {
    const usagePlans = [];

    try {
      // Use GetUsagePlansCommand to fetch all usage plans
      const getUsagePlansCommand = new GetUsagePlansCommand({});
      const usagePlansResponse =
        await this.apiGateway.send(getUsagePlansCommand);

      // Check if there are any usage plans in the response
      if (usagePlansResponse.items) {
        for (const usagePlan of usagePlansResponse.items) {
          const formattedPlan = {
            id: usagePlan.id || null,
            name: usagePlan.name || null,
            description: usagePlan.description || null,
            requestsPerSecond: usagePlan.throttle?.rateLimit || null,
            burstRequestsPerSecond: usagePlan.throttle?.burstLimit || null,
            requestsPerMonth: usagePlan.quota?.limit || null,
          };

          usagePlans.push(formattedPlan);
        }
      } else {
        this.logger.warn('No usage plans found.');
      }
    } catch (error) {
      this.logger.error('Failed to fetch usage plans', error.message);
    }

    return usagePlans;
  }

  // Method to generate AWS API Gateway Key
  async createAwsApiGatewayKey(): Promise<{ id: string; value: string }> {
    const apiKeyParams: CreateApiKeyCommandInput = {
      name: `histori-user-api-key`, // Unique key name for the user
      enabled: true,
      generateDistinctId: true, // Generates a distinct API key
      value: undefined, // Let API Gateway generate the key value
    };

    try {
      // Create the API key
      const createApiKeyCommand = new CreateApiKeyCommand(apiKeyParams);
      const apiKeyResponse = await this.apiGateway.send(createApiKeyCommand);
      // this.logger.debug(
      //   `AWS API Gateway Key Response: ${JSON.stringify(apiKeyResponse)}`,
      // );
      // this.logger.log(`Created AWS API Gateway Key for user`);
      return {
        id: apiKeyResponse.id, // Return the key ID generated by API Gateway
        value: apiKeyResponse.value, // Return the key value generated by API Gateway
      };
    } catch (error) {
      this.logger.error(
        `Failed to create API Gateway Key for user`,
        error.message,
      );
      // throw new Error('Failed to create API Gateway key');
    }
  }

  // Helper to get request count for a specific API key
  async getRequestCountForApiKey(
    user: User,
    tier: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const usagePlan: UsagePlan = await this.usagePlanRepository.findOne({
      where: { name: tier },
    });
    if (!usagePlan) {
      this.logger.error(`No usage plan found for user tier: ${tier}`);
      throw new Error('No usage plan found for user tier');
    }

    // Get usage for the specific API key over a specific time range
    const params: GetUsageCommandInput = {
      usagePlanId: usagePlan.id, // Usage plan ID for the associated API key
      keyId: user.apiKeyId, // API key ID to get the request count for
      startDate, // Start date in YYYY-MM-DD format
      endDate, // End date in YYYY-MM-DD format
    };

    try {
      const getUsageCommand = new GetUsageCommand(params);
      const usageData = await this.apiGateway.send(getUsageCommand);

      // this.logger.debug(`Usage data for API Key: ${user.apiKeyId}`, usageData);
      if (usageData.items[user.apiKeyId] === undefined) {
        // this.logger.warn(
        //   `API Key still has not made any requests: ${user.apiKeyId}`,
        // );
        return 0;
      }
      return this.sumRequestCounts(usageData.items[user.apiKeyId]);
    } catch (error) {
      this.logger.error(
        `Failed to get request count for API Key: ${user.apiKeyId}`,
        error.message,
      );
      return 0;
      // throw new Error('Failed to get request count for API key');
    }
  }

  sumRequestCounts(items: number[][]): number {
    let totalRequests = 0;

    // Loop through each API key's data
    // Sum the first value (meaningful request count) of each inner array
    totalRequests += items.reduce((sum, [firstValue]) => sum + firstValue, 0);
    return totalRequests;
  }

  // Helper to get the total request count for a usage plan
  async getTotalRequestCountForUsagePlan(tier: string): Promise<number> {
    const usagePlan: UsagePlan = await this.usagePlanRepository.findOne({
      where: { name: tier },
    });
    if (!usagePlan) {
      this.logger.error(`No usage plan found for user tier: ${tier}`);
      throw new Error('No usage plan found for user tier');
    }

    const params: GetUsagePlanCommandInput = {
      usagePlanId: usagePlan.id, // Usage plan ID to get the total request count for
    };

    try {
      const command = new GetUsagePlanCommand(params);
      const usagePlanResponse = await this.apiGateway.send(command);
      // Extract the quota details from the usage plan
      const quota = usagePlanResponse.quota;
      if (!quota) {
        this.logger.warn(`No quota found for usage plan: ${usagePlan.name}`);
        return Infinity; // Return "infinite" if no quota is defined
      }

      // The total allowed request count is the limit defined in the quota
      const totalRequestCount = quota.limit || 0;
      return totalRequestCount;
    } catch (error) {
      this.logger.error(
        `Failed to get total request count for usage plan: ${usagePlan.name}`,
        error.message,
      );
      throw new Error('Failed to get total request count for usage plan');
    }
  }

  // Method to associate an API Gateway Key with a usage plan based on the user's tier
  // Method to associate an API Gateway Key with a usage plan based on the user's tier
  async associateKeyWithUsagePlan(
    apiKeyId: string,
    previousTier: string,
    currentTier: string,
  ): Promise<void> {
    if (previousTier !== currentTier && previousTier !== 'None') {
      const previousUsagePlan: UsagePlan =
        await this.usagePlanRepository.findOne({
          where: { name: previousTier },
        });
      if (!previousUsagePlan) {
        this.logger.error(`No usage plan found for user tier: ${previousTier}`);
        throw new Error('No usage plan found for user tier');
      }
      await this.removeApiKeyPlanAssociation(apiKeyId, previousUsagePlan.id);
    }

    const currentUsagePlan = await this.usagePlanRepository.findOne({
      where: { name: currentTier },
    });
    if (!currentUsagePlan) {
      this.logger.error(
        `No usage plan found for user tier: ${currentUsagePlan}`,
      );
      throw new Error('No usage plan found for user tier');
    }

    // Step 2: Create new usage plan association
    const usagePlanKeyParams: CreateUsagePlanKeyCommandInput = {
      usagePlanId: currentUsagePlan.id, // ID of the Usage Plan to associate the key with
      keyId: apiKeyId, // ID of the API key created
      keyType: 'API_KEY', // The key type, must be 'API_KEY'
    };

    try {
      const createUsagePlanKeyCommand = new CreateUsagePlanKeyCommand(
        usagePlanKeyParams,
      );
      await this.apiGateway.send(createUsagePlanKeyCommand);

      this.logger.log(
        `Associated API Key with Usage Plan (${currentTier}) for api Key: ${apiKeyId}`,
      );
      // this.logger.debug(`Response from AWS: ${JSON.stringify(response)}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      this.logger.log('Already associated with the usage plan');
      // throw new Error('Failed to associate API Key with usage plan');
    }
  }

  async removeApiKeyTierAssociation(
    apiKeyId: string,
    tier: string,
  ): Promise<void> {
    const usagePlan: UsagePlan = await this.usagePlanRepository.findOne({
      where: { name: tier },
    });
    if (!usagePlan) {
      this.logger.error(`No usage plan found for user tier: ${tier}`);
      throw new Error('No usage plan found for user tier');
    }
    await this.removeApiKeyPlanAssociation(apiKeyId, usagePlan.id);
  }

  async removeApiKeyPlanAssociation(
    apiKeyId: string,
    usagePlanId: string,
  ): Promise<void> {
    const params = {
      usagePlanId, // The existing usage plan ID
      keyId: apiKeyId, // The API key ID
    };

    try {
      const deleteUsagePlanKeyCommand = new DeleteUsagePlanKeyCommand(params);
      await this.apiGateway.send(deleteUsagePlanKeyCommand);
      this.logger.log(
        `Successfully disassociated API Key ${apiKeyId} from Usage Plan ${usagePlanId}`,
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      this.logger.log('Already disassociated with the usage plan');
    }
  }

  /**
   * Remove an API key from AWS API Gateway
   * @param apiKeyId The ID of the API key to be removed
   */
  async removeApiKey(apiKeyId: string): Promise<void> {
    if (!apiKeyId) {
      this.logger.error('API Key ID is required to remove an API key.');
      throw new Error('API Key ID is required to remove an API key.');
    }

    try {
      const deleteApiKeyCommand = new DeleteApiKeyCommand({ apiKey: apiKeyId });
      await this.apiGateway.send(deleteApiKeyCommand);
      this.logger.log(`Successfully deleted API key: ${apiKeyId}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      this.logger.log('Already deleted the API key');
      //this.logger.error(`Failed to delete API key: ${apiKeyId}`, error.message);
      // throw new Error(`Failed to delete API key: ${apiKeyId}`);
    }
  }
}
