import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class OAuthService {
  constructor(private readonly configService: ConfigService) {}

  // Generate Google OAuth URL
  getGoogleAuthURL() {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
      redirect_uri: `${this.configService.get('BASE_URL')}/signin?provider=google`,
      client_id: this.configService.get('GOOGLE_CLIENT_ID'),
      access_type: 'offline',
      response_type: 'code',
      prompt: 'consent',
      scope: ['profile', 'email'].join(' '),
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  // Generate GitHub OAuth URL
  getGithubAuthURL() {
    const rootUrl = 'https://github.com/login/oauth/authorize';
    const options = {
      redirect_uri: `${this.configService.get('BASE_URL')}/signin?provider=github`,
      client_id: this.configService.get('GITHUB_CLIENT_ID'),
      scope: 'user:email',
    };

    const qs = new URLSearchParams(options);
    return `${rootUrl}?${qs.toString()}`;
  }

  // Exchange Google code for access token
  async getGoogleAccessToken(code: string) {
    const url = 'https://oauth2.googleapis.com/token';
    const values = {
      code,
      client_id: this.configService.get('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.get('GOOGLE_CLIENT_SECRET'),
      redirect_uri: `${this.configService.get('BASE_URL')}/signin?provider=google`,
      grant_type: 'authorization_code',
    };

    try {
      const response = await axios.post(
        url,
        new URLSearchParams(values).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json', // GitHub requires this header to return JSON
          },
        },
      );

      if (response.data.error) {
        throw new Error(
          `GitHub token exchange error: ${response.data.error_description}`,
        );
      }

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get GitHub access token: ${error.message}`);
    }
  }

  async getGoogleUserInfo(accessToken: string) {
    const url = 'https://www.googleapis.com/oauth2/v2/userinfo';
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.data;
  }

  // In OAuthService
  async getGithubUserInfo(accessToken: string) {
    const url = 'https://api.github.com/user';
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const userInfo = response.data;

    return {
      id: userInfo.id, // GitHub ID
      email: userInfo.email, // Public email, can be null
      name: userInfo.name, // Full name, can be null
      login: userInfo.login, // GitHub username
      avatar_url: userInfo.avatar_url, // GitHub profile picture
    };
  }

  // Exchange GitHub code for access token
  async getGithubAccessToken(code: string) {
    const url = 'https://github.com/login/oauth/access_token';
    const values = {
      code,
      client_id: this.configService.get('GITHUB_CLIENT_ID'),
      client_secret: this.configService.get('GITHUB_CLIENT_SECRET'),
      redirect_uri: `${this.configService.get('BASE_URL')}/signin?provider=github`,
    };

    const response = await axios.post(
      url,
      new URLSearchParams(values).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      },
    );

    return response.data;
  }
}
