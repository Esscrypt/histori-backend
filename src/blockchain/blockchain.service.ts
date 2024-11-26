import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ethers } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// import axios from 'axios';
import { User } from 'src/auth/entities/user.entity';
import { Cron } from '@nestjs/schedule';
import { v4 as uuidv4 } from 'uuid';
import { AWSService } from 'src/awsservice/awsservice.service';
import { PaymentsService } from 'src/payments/payments.service';

import bn from 'bignumber.js'; // Importing bignumber.js for precision control

@Injectable()
export class BlockchainService implements OnModuleInit {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private readonly logger = new Logger(BlockchainService.name);

  private readonly depositContractABI: string[] = [
    'event DepositedForAPI(address indexed, uint256, uint8)',
    'event DepositedForRPC(address indexed, uint256, uint8)',
    'function apiDeposits(address) view returns (uint256)',
    'function rpcDeposits(address) view returns (uint256)',
    'function apiUserTiers(address) view returns (uint8)',
    'function rpcUserTiers(address) view returns (uint8)',
  ];

  private readonly tierMapping: { [key: number]: string } = {
    0: 'Starter',
    1: 'Growth',
    2: 'Business',
  };

  private readonly tierDailyPriceMapping: { [key: number]: number } = {
    0: 1.67, // Starter tier daily price in USD
    1: 6.67, // Growth tier daily price in USD
    2: 13.33, // Business tier daily price in USD
  };

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly paymentService: PaymentsService,
    private readonly awsService: AWSService,
  ) {
    this.provider = new ethers.JsonRpcProvider(process.env.HISTORI_RPC_URL);

    this.contract = new ethers.Contract(
      process.env.DEPOSIT_ADDRESS,
      this.depositContractABI,
      this.provider,
    );
  }

  private generateRandomString(): string {
    return uuidv4().replace(/-/g, '').substring(0, 8); // Remove hyphens and get the first 8 characters
  }

  public async createNewUser(
    email?: string,
    githubId?: string,
    referrerCode?: string,
  ): Promise<User> {
    const stripeCustomerId =
      await this.paymentService.createStripeCustomer(email);

    const user = this.userRepository.create({
      email,
      githubId,
      stripeCustomerId,
      referrerCode,
      isActive: true,
    });

    const apiKey = await this.awsService.createAwsApiGatewayKey();
    this.logger.log(`API key created:`, JSON.stringify(apiKey));
    user.apiKeyId = apiKey.id;
    user.apiKeyValue = apiKey.value;
    const prefix = this.generateRandomString();
    const suffix = this.generateRandomString();
    user.projectId = `${prefix}${apiKey.id}${suffix}`;
    user.tier = 'Free'; // Default tier for new users
    user.rpcTier = 'Free Archival MultiNode'; // Default tier for new users
    // Associate the API key with a usage plan
    await this.awsService.associateKeyWithUsagePlan(apiKey.id, 'Free', 'Free');
    await this.awsService.associateKeyWithUsagePlan(
      apiKey.id,
      'Free Archival MultiNode',
      'Free Archival MultiNode',
    );

    return await this.userRepository.save(user);
  }

  async handleDepositEvent(
    event: any,
    userAddress: string,
    amount: bn,
    tier: number,
    userTierKey: keyof User,
    userPlanEndDateKey: keyof User,
  ): Promise<void> {
    this.logger.log(`Handling deposit event for ${userAddress}`);

    if (process.env.NODE_ENV === 'production') {
      await this.waitForConfirmations(event.log.transactionHash, 50);
    }

    this.logger.log('Transaction confirmed, fetching user deposit details...');

    let user: any = await this.getUserByWeb3Address(userAddress);
    if (!user) {
      user = await this.createNewUser();
    }

    const tokenPriceInUSD: bn | undefined =
      await this.fetchCurrentHSTPriceInUSD();

    if (!tokenPriceInUSD) {
      this.logger.error('Error fetching HST price.');
      throw new BadRequestException('Error fetching HST price.');
    }
    this.logger.log(`Current HST price in USD: ${tokenPriceInUSD}`);

    const totalDepositInUSD = amount.multipliedBy(tokenPriceInUSD);
    this.logger.log(`Total deposit in USD: ${totalDepositInUSD}`);
    this.logger.log(`Tier: ${tier}`);

    const subscriptionDurationInDays = totalDepositInUSD
      .dividedBy(new bn(this.tierDailyPriceMapping[tier]))
      .toNumber();
    this.logger.log(
      'Subscription duration in days:',
      subscriptionDurationInDays,
    );

    user[userTierKey] = this.tierMapping[tier];
    user[userTierKey] =
      userTierKey === 'tier'
        ? user[userTierKey]
        : user[userTierKey] + ' Archival MultiNode';

    user[userPlanEndDateKey] = new Date(
      Date.now() + subscriptionDurationInDays * 24 * 60 * 60 * 1000,
    );

    await this.userRepository.save(user);
    this.logger.log(
      `User ${userAddress} updated with new tier and plan end date. Tier: ${user[userTierKey]}, Plan end date: ${user[userPlanEndDateKey]}`,
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      this.contract.on(
        'DepositedForRPC',
        async (userAddress, amount, tier, event) => {
          console.log('DepositedForRPC event received');
          // console.log({ userAddress, amount, tier, event });
          const amountEth = new bn(ethers.formatEther(amount));
          await this.handleDepositEvent(
            event,
            userAddress,
            amountEth,
            tier,
            'rpcTier',
            'rpcPlanEndDate',
          );
        },
      );

      this.contract.on(
        'DepositedForAPI',
        async (userAddress, amount, tier, event) => {
          this.logger.log('DepositedForAPI event received');
          // console.log({ userAddress, amount, tier, event });
          const amountEth = new bn(ethers.formatEther(amount));
          await this.handleDepositEvent(
            event,
            userAddress,
            amountEth,
            tier,
            'tier',
            'planEndDate',
          );
        },
      );
    } catch (error) {
      this.logger.error('Error handling event:', error);
    }
  }

  private async waitForConfirmations(
    txHash: string,
    confirmations: number,
  ): Promise<void> {
    const receipt = await this.provider.waitForTransaction(
      txHash,
      confirmations,
    );
    if (!receipt || receipt.status !== 1) {
      this.logger.error('Transaction was not confirmed successfully.');
      throw new BadRequestException(
        'Transaction was not confirmed successfully.',
      );
    }
    this.logger.log('Transaction confirmed successfully.');
  }

  @Cron('0 0 * * *')
  private async checkAndDemoteTiers(): Promise<void> {
    this.logger.log('Checking and demoting users with expired plans...');
    const users = await this.userRepository.find();
    const now = new Date();

    for (const user of users) {
      let modified = false;
      if (user.planEndDate && user.planEndDate < now) {
        user.tier = 'None';
        modified = true;
      }
      if (user.rpcPlanEndDate && user.rpcPlanEndDate < now) {
        user.rpcTier = 'None';
        modified = true;
      }
      if (modified) {
        this.logger.log(`User ${user.web3Address} demoted to 'None' tier.`);
        await this.userRepository.save(user);
      }
    }
  }

  private async getUserByWeb3Address(
    web3Address: string,
  ): Promise<User | undefined> {
    return this.userRepository.findOne({ where: { web3Address } });
  }

  // Fetch HST to USD price by interacting with Uniswap on-chain
  public async fetchCurrentHSTPriceInUSD(): Promise<bn | undefined> {
    try {
      // Fetch ETH to USD price from on-chain oracle
      const weiToUSD: bn = await this.getWeiToUSD();
      const ethToUSD = weiToUSD.dividedBy(1e18);

      // Fetch HST to ETH price directly from Uniswap pool
      const historiToEthPrice = await this.getHistoriToETHPrice();

      this.logger.log(`Histori to ETH Price: ${historiToEthPrice.toString()}`);

      // Calculate HST to USD by multiplying ETH to USD by HST to ETH price
      const historiPriceInUSD = ethToUSD.multipliedBy(historiToEthPrice);
      return historiPriceInUSD;
    } catch (error) {
      this.logger.error('Error fetching HST price from blockchain:', error);
      return undefined;
    }
  }

  // Fetch the HST token balance for a specific address
  public async fetchHstBalance(
    web3Address: string,
  ): Promise<string | undefined> {
    try {
      const tokenAddress = process.env.HST_TOKEN_ADDRESS;
      const abi = ['function balanceOf(address owner) view returns (uint256)'];
      const tokenContract = new ethers.Contract(
        tokenAddress,
        abi,
        this.provider,
      );

      const balance = await tokenContract.balanceOf(web3Address);
      return ethers.formatUnits(balance, 18); // assuming HST has 18 decimals
    } catch (error) {
      this.logger.error('Error fetching HST balance from blockchain:', error);
      return undefined;
    }
  }

  // Helper method to get the ETH to USD price from on-chain oracle
  public async getWeiToUSD(): Promise<bn> {
    try {
      const poolAddress = process.env.ETH_USD_POOL_ADDRESS;
      if (!poolAddress) {
        throw new BadRequestException(`Pool address not found for ETH/USD.`);
      }

      this.logger.log(`Using pool address: ${poolAddress}`);

      // Initialize the Uniswap V3 pool contract
      const poolContract = new ethers.Contract(
        poolAddress,
        [
          'function slot0() public view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
        ],
        this.provider,
      );

      const slot0 = await poolContract.slot0();

      // Configure BigNumber settings and calculate price
      bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });
      const sqrtPriceX96 = new bn(slot0[0].toString());
      const price = sqrtPriceX96.div(new bn(2).pow(96)).pow(2);
      const priceInverse = new bn(1).div(price);

      // Adjust the price to USD format (assuming the pair ratio to scale by 10^12)
      const priceAdjusted = priceInverse.multipliedBy(new bn(10).pow(12));

      return priceAdjusted;
    } catch (error) {
      this.logger.error('Error fetching ETH/USDT price:', error);
      throw new BadRequestException(
        `Failed to fetch ETH/USDT price: ${error.message}`,
      );
    }
  }

  // Helper method to get the HST to ETH price from Uniswap pool
  private async getHistoriToETHPrice(): Promise<bn> {
    const historiPoolAddress = process.env.HISTORI_POOL_ADDRESS;
    if (!historiPoolAddress) {
      throw new BadRequestException(`Unsupported network for HST.`);
    }

    this.logger.log(`Using ETH/HST pool address: ${historiPoolAddress}`);
    const poolAbi = [
      'function slot0() public view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    ];
    const poolContract = new ethers.Contract(
      historiPoolAddress,
      poolAbi,
      this.provider,
    );

    const slot0 = await poolContract.slot0();
    bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

    const sqrtPriceX96 = new bn(slot0[0].toString());
    const price = sqrtPriceX96.div(new bn(2).pow(96)).pow(2);
    const priceInverse = new bn(1).div(price);
    return priceInverse;
  }
}
