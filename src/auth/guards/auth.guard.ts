/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity'; // Adjust this path to your actual User entity path
import axios from 'axios';

@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>, // Inject UserRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No Bearer token provided');
    }

    const token = authHeader.split(' ')[1];

    // Check if the token is a valid JWT from the app
    const jwtPayload = await this.validateJwtToken(token);
    if (jwtPayload) {
      const user = await this.userRepository.findOne({
        where: { id: jwtPayload.userId },
      });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      request.user = user; // Set req.user with the user record from the DB
      return true;
    }

    // Check if the token is a valid Google access token
    const googleUser = await this.validateGoogleToken(token);
    if (googleUser) {
      const user = await this.userRepository.findOne({
        where: { email: googleUser.email },
      });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      request.user = user; // Set req.user with the user record from the DB
      return true;
    }

    // Check if the token is a valid GitHub access token
    const githubUser = await this.validateGithubToken(token);
    if (githubUser) {
      const user = await this.userRepository.findOne({
        where: { githubId: githubUser.userId },
      });
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      request.user = user; // Set req.user with the user record from the DB
      return true;
    }

    // If none of the above validations passed, throw an unauthorized exception
    throw new UnauthorizedException('Invalid token');
  }

  // Validate JWT issued by your application
  async validateJwtToken(token: string): Promise<any> {
    try {
      const decoded = this.jwtService.verify(token, {
        secret: this.configService.get('ACCESS_TOKEN_SECRET'),
      });
      return decoded; // If verification is successful, return the decoded payload
    } catch (error) {
      return null; // If verification fails, return null
    }
  }

  // Validate Google access token by calling Google's token info API
  async validateGoogleToken(token: string): Promise<any> {
    const googleTokenInfoUrl = `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`;

    try {
      const response = await axios.get(googleTokenInfoUrl);
      if (
        response.data.audience === this.configService.get('GOOGLE_CLIENT_ID')
      ) {
        return {
          email: response.data.email,
          userId: response.data.user_id,
        };
      }
      return null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return null;
    }
  }

  // Validate GitHub access token by calling GitHub's user API
  async validateGithubToken(token: string): Promise<any> {
    const githubUserUrl = 'https://api.github.com/user';

    try {
      const response = await axios.get(githubUserUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return {
        userId: response.data.id,
        username: response.data.login,
        email: response.data.email,
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return null;
    }
  }
}
