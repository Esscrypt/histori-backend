import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { User } from './auth/entities/user.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { StripeModule } from '@golevelup/nestjs-stripe';
import { PaymentsService } from './payments/payments.service';
import { MailService } from './auth/services/mail.service';
import { PaymentsController } from './payments/payments.controller';
import { JwtService } from '@nestjs/jwt';
import { AWSService } from './awsservice/awsservice.service';
import { UsagePlansModule } from './usage-plans/usage-plans.module';
import { UsagePlan } from './usage-plans/entities/usage-plan.entity';
import { ApiRequesterService } from './api-requester/api-requester.service';
import { ScheduleModule } from '@nestjs/schedule';
import { BlockchainService } from './blockchain/blockchain.service';
import { BlockchainController } from './blockchain/blockchain.controller';
import { AuthService } from './auth/services/auth.service';
import { OAuthService } from './auth/services/oauth.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`, // Load .env based on NODE_ENV
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [User, UsagePlan],
        synchronize: true, // Only synchronize in development
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, UsagePlan]),
    ThrottlerModule.forRoot([
      {
        ttl: 1000,
        limit: 5,
      },
    ]),
    StripeModule.forRootAsync(StripeModule, {
      useFactory: (configService: ConfigService) => ({
        apiKey: configService.get<string>('STRIPE_SECRET_KEY'),
        webhookConfig: {
          stripeSecrets: {
            account: configService.getOrThrow('STRIPE_WEBHOOK_SECRET'),
            accountTest: configService.getOrThrow('STRIPE_WEBHOOK_SECRET'),
          },
          requestBodyProperty: 'rawBody',
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsagePlansModule,
    HttpModule,
  ],
  providers: [
    Logger,
    PaymentsService,
    MailService,
    JwtService,
    OAuthService,
    AWSService,
    AuthService,
    // ApiRequesterService, // Commented out to prevent the cron job from running. Enable this line to run the lambda keep warm cron job
    BlockchainService,
  ],
  exports: [AuthService, BlockchainService],
  controllers: [PaymentsController, BlockchainController],
})
export class AppModule {}
