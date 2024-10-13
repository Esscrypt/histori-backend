import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { MailService } from './mail.service';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from '../dto/create-user.dto';
import { LoginDto } from '../dto/login.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { PaymentsService } from 'src/payments/payments.service';
import { OAuthService } from './oauth.service';
import { HttpService } from '@nestjs/axios';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';

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
    private readonly httpService: HttpService,
  ) {}

  // Reusable method for creating a new user
  private async createNewUser(
    email: string,
    githubId?: string,
    referrerCode?: string,
  ): Promise<User> {
    const stripeCustomerId =
      await this.paymentService.createStripeCustomer(email);

    const apiKey = `HISTORI_${uuidv4().replace(/[^a-zA-Z0-9]/g, '')}`;

    const newUser = this.userRepository.create({
      email,
      apiKey,
      githubId,
      stripeCustomerId,
      referrerCode,
      isActive: true,
    });

    return await this.userRepository.save(newUser);
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
      existingUser = await this.createNewUser(
        userInfo.email,
        githubId,
        referrer,
      );
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

    const stripeCustomerId =
      await this.paymentService.createStripeCustomer(email);

    const user = this.userRepository.create({
      apiKey: `HISTORI_${uuidv4().replace(/[^a-zA-Z0-9]/g, '')}`,
      email,
      password,
      isActive: false,
      referrerCode: referrer,
      stripeCustomerId,
    });

    const newUser = await this.userRepository.save(user);

    return await this.sendConfirmation(email, newUser.id);
  }

  // Send confirmation email
  async sendConfirmation(email: string, userId?: number) {
    const user = await this.findUserByEmail(email, userId);
    //if (user.isActive) throw new BadRequestException('User is already active');

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

    const user = await this.userRepository.findOne({
      where: { id: decoded.userId },
    });
    if (!user) throw new BadRequestException('Invalid token');
    if (!user.email) {
      user.email = decoded.email;
    }
    user.isActive = true;
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
        'User has no password. Maybe you signed up with Google or GitHub?',
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
      const stripeCustomerId = await this.paymentService.createStripeCustomer();
      // Optionally, you can validate the wallet address further if necessary
      user = this.userRepository.create({
        apiKey: `HISTORI_${uuidv4().replace(/[^a-zA-Z0-9]/g, '')}`,
        web3Address: walletAddress,
        isActive: true, // Assuming new wallet-based users are active by default
        email: '', // Since it's a wallet-based login, you may not have an email
        stripeCustomerId, // stripeCustomerId,
        referrerCode: referrer,
      });
      await this.userRepository.save(user);
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
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`;
    const response = await this.httpService.post(verificationUrl).toPromise();
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
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: [
        'email',
        'apiKey',
        'tier',
        'requestCount',
        'requestLimit',
        'referralCode',
        'referralPoints',
        'serverProvisioned',
      ],
    });
    return user;
  }

  async deleteUser(userId: number) {
    try {
      const user = await this.userRepository.findOne({ where: { id: userId } });

      if (!user) {
        throw new NotFoundException('User not found');
      }

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

      await this.userRepository.remove(user);

      return { message: 'User account has been deleted successfully.' };
    } catch (error) {
      this.logger.error('Failed to confirm user deletion', error.stack);
      throw new BadRequestException('Invalid or expired token.');
    }
  }
}
