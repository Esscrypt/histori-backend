import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { MailService } from './mail.service';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from '../dto/create-user.dto';
import { LoginDto } from '../dto/login.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { PaymentsService } from 'src/payments/payments.service';
import { OAuthService } from './oauth.service';
// import { HttpService } from '@nestjs/axios';
import { ethers } from 'ethers';
import { AWSService } from 'src/awsservice/awsservice.service';
// import { BlockchainService } from 'src/blockchain/blockchain.service';
import { v4 as uuidv4 } from 'uuid';

import bn from 'bignumber.js'; // Importing bignumber.js for precision control
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly paymentService: PaymentsService,
    private readonly oAuthService: OAuthService,
    private readonly awsService: AWSService,
  ) {}

  private generateRandomString(): string {
    return uuidv4().replace(/-/g, '').substring(0, 8); // Remove hyphens and get the first 8 characters
  }

  async removeApiKey(user: User) {
    if (user.apiKeyId) {
      try {
        await this.awsService.removeApiKey(user.apiKeyId);
        console.log(`API key ${user.apiKeyId} deleted from AWS.`);
      } catch (error) {
        throw new Error(
          `Failed to delete API key ${user.apiKeyId}: ${error.message}`,
        );
      }
    }
  }

  // Reusable method for creating a new user
  public async createNewUser(options: {
    web3Address?: string;
    email?: string;
    password?: string;
    isActive?: boolean;
    githubId?: string;
    referrerCode?: string;
    plan?: string;
    quicknodeId?: string;
  }): Promise<User> {
    const {
      web3Address,
      email,
      password,
      isActive,
      githubId,
      referrerCode,
      plan,
      quicknodeId,
    } = options;
    const stripeCustomerId =
      await this.paymentService.createStripeCustomer(email);

    let userDto: DeepPartial<User> = {
      email,
      password,
      isActive: isActive === undefined ? true : isActive,
      githubId,
      web3Address,
      stripeCustomerId,
      referrerCode,
    };

    if (plan) {
      const isRPCPlan = plan.includes('MultiNode');
      if (isRPCPlan) {
        userDto = {
          ...userDto,
          rpcTier: plan,
        };
      } else {
        userDto = {
          ...userDto,
          tier: plan,
        };
      }
    }

    if (quicknodeId) {
      userDto = {
        ...userDto,
        quicknodeId,
      };
    }

    const user = this.userRepository.create(userDto);

    const apiKey = await this.awsService.createAwsApiGatewayKey();
    this.logger.log(`API key created:`, JSON.stringify(apiKey));
    user.apiKeyId = apiKey.id;
    user.apiKeyValue = apiKey.value;
    const prefix = this.generateRandomString();
    const suffix = this.generateRandomString();
    user.projectId = `${prefix}${apiKey.id}${suffix}`;
    if (plan) {
      const isRPCPlan = plan.includes('MultiNode');
      user.tier = isRPCPlan ? 'Free' : plan;
      user.rpcTier = isRPCPlan ? plan : 'Free Archival MultiNode';

      await this.awsService.associateKeyWithUsagePlan(
        apiKey.id,
        'Free',
        user.tier,
      );
      await this.awsService.associateKeyWithUsagePlan(
        apiKey.id,
        'Free Archival MultiNode',
        user.rpcTier,
      );
    } else {
      user.tier = 'Free'; // Default tier for new users
      user.rpcTier = 'Free Archival MultiNode'; // Default tier for new users
      // Associate the API key with a usage plan
      await this.awsService.associateKeyWithUsagePlan(
        apiKey.id,
        'Free',
        'Free',
      );
      await this.awsService.associateKeyWithUsagePlan(
        apiKey.id,
        'Free Archival MultiNode',
        'Free Archival MultiNode',
      );
    }

    return await this.userRepository.save(user);
  }

  // Reusable method for generating access and refresh tokens
  private generateTokens(user: User): {
    accessToken: string;
    refreshToken: string;
  } {
    const payload = {
      userId: user.id,
      email: user.email,
      stripeCustomerId: user.stripeCustomerId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.ACCESS_TOKEN_SECRET,
      expiresIn: process.env.ACCESS_TOKEN_EXPIRATION,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: process.env.REFRESH_TOKEN_EXPIRATION,
    });

    return { accessToken, refreshToken };
  }

  // Reusable method to handle OAuth login (Google/GitHub)
  private async handleOAuthLogin(
    userInfo: any,
    referrer?: string,
    githubId?: string,
  ): Promise<User> {
    let existingUser = await this.userRepository.findOne({
      where: { email: userInfo.email },
    });

    if (!existingUser && githubId) {
      existingUser = await this.userRepository.findOne({
        where: { githubId },
      });
    }

    if (!existingUser) {
      existingUser = await this.createNewUser({
        email: userInfo.email,
        githubId,
        referrerCode: referrer,
      });
    }

    return existingUser;
  }

  // Google Login
  async googleLogin(code: string, referrer?: string) {
    const tokens = await this.oAuthService.getGoogleAccessToken(code);
    const userInfo = await this.oAuthService.getGoogleUserInfo(
      tokens.access_token,
    );
    const user = await this.handleOAuthLogin(userInfo, referrer);
    return this.generateTokens(user);
  }

  // GitHub Login
  async githubLogin(code: string, referrer?: string) {
    const tokens = await this.oAuthService.getGithubAccessToken(code);
    const userInfo = await this.oAuthService.getGithubUserInfo(
      tokens.access_token,
    );
    const user = await this.handleOAuthLogin(userInfo, referrer, userInfo.id);
    return this.generateTokens(user);
  }

  // Register a new user
  async register(createUserDto: CreateUserDto) {
    const { email, password, referrer } = createUserDto;
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) throw new BadRequestException('User already exists');

    const newUser = await this.createNewUser({
      email,
      password,
      isActive: false,
      referrerCode: referrer,
    });

    return await this.sendConfirmation(email, newUser.id);
  }

  // Send confirmation email
  async sendConfirmation(email: string, userId?: number) {
    const user = await this.findUserByEmail(email, userId);

    const confirmationToken = this.jwtService.sign(
      { userId: user.id, email: email },
      {
        secret: process.env.CONFIRMATION_TOKEN_SECRET,
        expiresIn: process.env.CONFIRMATION_TOKEN_EXPIRATION,
      },
    );

    await this.mailService.sendUserConfirmation(email, confirmationToken);
    return { message: 'Confirmation email has been sent' };
  }
  п;

  // Find a user by email or userId
  private async findUserByEmail(email: string, userId?: number): Promise<User> {
    let user;
    if (!userId) {
      user = await this.userRepository.findOne({ where: { email } });
    } else {
      user = await this.userRepository.findOne({ where: { id: userId } });
    }

    if (!user) throw new BadRequestException('User not found');
    return user;
  }

  // Confirm the user's email
  async jwtLogin(token: string) {
    const decoded: any = this.jwtService.verify(token, {
      secret: process.env.CONFIRMATION_TOKEN_SECRET,
    });

    let user = await this.userRepository.findOne({
      where: { id: decoded.userId },
    });
    if (!user) {
      user = await this.userRepository.findOne({
        where: { id: decoded['quicknode_id'] },
      });
    }
    if (!user) {
      throw new BadRequestException('Invalid token');
    }
    if (!user.email && decoded.email) {
      user.email = decoded.email;
    }
    if (!user.isActive) {
      user.isActive = true;
    }

    await this.userRepository.save(user);

    return this.generateTokens(user);
  }

  // Login a user
  async login(
    loginDto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { email, password } = loginDto;
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user) throw new BadRequestException('Invalid credentials');
    if (!user.password) {
      throw new BadRequestException(
        'User has no password. Maybe you signed up with Google, GitHub or Web3?',
      );
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) throw new BadRequestException('Invalid credentials');
    if (!user.isActive)
      throw new BadRequestException('Please confirm your email');

    return this.generateTokens(user);
  }

  // Wallet-based authentication
  async loginWithWallet(
    walletAddress: string,
    message: string,
    signature: string,
    referrer?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const isVerified = await this.verifySignature(
      walletAddress,
      message,
      signature,
    );
    if (!isVerified)
      throw new UnauthorizedException('Signature verification failed');

    let user = await this.userRepository.findOne({
      where: { web3Address: walletAddress },
    });

    if (!user) {
      user = await this.createNewUser({
        web3Address: walletAddress,
        referrerCode: referrer,
      });
    }

    return this.generateTokens(user);
  }

  // Method to verify a message signed by the user's wallet
  async verifySignature(
    web3Address: string,
    message: string,
    signature: string,
  ): Promise<boolean> {
    try {
      // Recover the address from the signature
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === web3Address.toLowerCase();
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  // Verify reCAPTCHA token
  async verifyCaptcha(token: string): Promise<boolean> {
    const payload = {
      event: {
        token: token,
        siteKey: '6Ld6hU4qAAAAAFlfhkFGbDdQVoTUm6MKQGTN2OIA',
      },
    };
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const verificationUrl = `https://recaptchaenterprise.googleapis.com/v1/projects/histori-1727094431021/assessments?key=${secret}`;
    const response = await axios.post(verificationUrl, payload);
    this.logger.log('reCAPTCHA verification response:', response.data);
    return response.data.success;
  }

  // Refresh the access token
  async refreshAccessToken(refreshToken: string): Promise<string> {
    if (!refreshToken)
      throw new UnauthorizedException('Refresh token required');

    try {
      const decoded: any = this.jwtService.verify(refreshToken, {
        secret: process.env.REFRESH_TOKEN_SECRET!,
      });
      const user = await this.userRepository.findOne({
        where: { id: decoded.userId },
      });
      if (!user) throw new ForbiddenException('Invalid refresh token');

      const newAccessToken = this.jwtService.sign(
        { userId: user.id },
        {
          secret: process.env.ACCESS_TOKEN_SECRET!,
          expiresIn: process.env.ACCESS_TOKEN_EXPIRATION,
        },
      );

      return newAccessToken;
    } catch (error: any) {
      this.logger.error(
        `Error in refreshAccessToken method: ${error.message}`,
        error.stack,
      );
      throw new ForbiddenException('Invalid refresh token');
    }
  }

  // Handle forgot password
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const resetPasswordToken = this.jwtService.sign(
      { userId: user.id },
      {
        secret: process.env.RESET_PASSWORD_TOKEN_SECRET,
        expiresIn: process.env.RESET_PASSWORD_TOKEN_EXPIRATION,
      },
    );

    await this.mailService.sendPasswordReset(email, resetPasswordToken);
    return { message: 'A reset password link has been sent.' };
  }

  // Reset the user's password
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, newPassword } = resetPasswordDto;

    try {
      const decoded: any = this.jwtService.verify(token, {
        secret: process.env.RESET_PASSWORD_TOKEN_SECRET!,
      });

      const user = await this.userRepository.findOne({
        where: { id: decoded.userId },
      });
      if (!user)
        throw new BadRequestException('Invalid token or user does not exist');

      user.password = newPassword;
      await this.userRepository.save(user);

      return { message: 'Password has been updated' };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new BadRequestException('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new BadRequestException('Invalid token');
      } else {
        throw new BadRequestException('Failed to reset password');
      }
    }
  }

  async getUserProfile(userId: number): Promise<any> {
    const user: any = await this.userRepository.findOne({
      where: { id: userId },
      select: [
        'email',
        'apiKeyValue',
        'projectId',
        'tier',
        'rpcTier',
        'planEndDate',
        'rpcPlanEndDate',
        'requestLimit',
        'requestCount',
        'rpcRequestCount',
        'rpcRequestLimit',
        'referralCode',
        'referralPoints',
        'web3Address',
      ],
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    //TODO: Fetch HST balance and price from blockchain service
    let currentBalanceInWei: string | undefined;
    let currentHstPriceInUSD: bn | undefined;
    // const currentBalanceInWei: string | undefined =
    //   await this.blockchainService.fetchHstBalance(user.web3Address);
    // const currentHstPriceInUSD: bn | undefined =
    //   await this.blockchainService.fetchCurrentHSTPriceInUSD();

    if (currentBalanceInWei && currentHstPriceInUSD) {
      user.hstBalance = currentBalanceInWei;
      if (process.env.NODE_ENV === 'development') {
        user.hstToUSD = 0.5; // mock value for development
      } else {
        user.hstToUSD = currentHstPriceInUSD;
      }
      user.totalBalanceInUSD = `$${new bn(user.hstBalance).multipliedBy(user.hstToUSD).toString()}`;
    } else {
      user.hstBalance = '0';
      user.hstToUSD = 0;
      user.totalBalanceInUSD = '$0';
    }

    if (user.tier !== 'None') {
      const currentDate = new Date();
      const startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1,
      )
        .toISOString()
        .split('T')[0]; // Format: YYYY-MM-DD
      const endDate = currentDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
      // Fetch the current request count from AWS
      user.requestCount = await this.awsService.getRequestCountForApiKey(
        user,
        user.tier,
        startDate,
        endDate,
      );
    }
    if (user.rpcTier !== 'None') {
      const currentDate = new Date();
      const startDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1,
      )
        .toISOString()
        .split('T')[0]; // Format: YYYY-MM-DD
      const endDate = currentDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
      // Fetch the current request count from AWS
      user.rpcRequestCount = await this.awsService.getRequestCountForApiKey(
        user,
        user.rpcTier,
        startDate,
        endDate,
      );
    }

    return user;
  }

  async deleteUser(userId: number) {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.email) {
        // Generate a JWT token for confirmation
        const deletionToken = this.jwtService.sign(
          { userId: user.id },
          {
            secret: process.env.DELETION_TOKEN_SECRET,
            expiresIn: process.env.DELETION_TOKEN_EXPIRATION, // E.g., '1h'
          },
        );
        // Send email for deletion confirmation
        await this.mailService.sendDeletionConfirmation(
          user.email,
          deletionToken,
        );

        return {
          message: 'A confirmation email has been sent for account deletion.',
        };
      } else {
        await this.paymentService.deleteCustomer(user.stripeCustomerId);

        if (user.apiKeyId && user.tier !== 'None') {
          await this.awsService.removeApiKeyTierAssociation(
            user.apiKeyId,
            user.tier,
          );
        }
        if (user.apiKeyId && user.rpcTier !== 'None') {
          await this.awsService.removeApiKeyTierAssociation(
            user.apiKeyId,
            user.rpcTier,
          );
        }
        await this.removeApiKey(user);
        await this.userRepository.remove(user);
        return { message: 'User account has been deleted successfully.' };
      }
    } catch (error) {
      this.logger.error(
        `Failed to initiate user deletion for user ID: ${userId}`,
        error.stack,
      );
      throw new BadRequestException('Failed to delete user.');
    }
  }

  async confirmDeletion(token: string) {
    try {
      const decoded: any = this.jwtService.verify(token, {
        secret: process.env.DELETION_TOKEN_SECRET,
      });

      const user = await this.userRepository.findOne({
        where: { id: decoded.userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      await this.paymentService.deleteCustomer(user.stripeCustomerId);

      await this.awsService.removeApiKeyTierAssociation(
        user.apiKeyId,
        user.tier,
      );
      await this.awsService.removeApiKeyTierAssociation(
        user.apiKeyId,
        user.rpcTier,
      );
      await this.removeApiKey(user);
      await this.userRepository.remove(user);

      return { message: 'User account has been deleted successfully.' };
    } catch (error) {
      this.logger.error('Failed to confirm user deletion', error.stack);
      throw new BadRequestException('Invalid or expired token.');
    }
  }
}
