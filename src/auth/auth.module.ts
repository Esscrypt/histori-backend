import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { User } from './entities/user.entity';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailService } from './services/mail.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PaymentsService } from 'src/payments/payments.service';
import { StripeModule } from '@golevelup/nestjs-stripe';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { join } from 'path';
import { OAuthService } from './services/oauth.service';
import { HttpModule } from '@nestjs/axios';
import { AWSService } from 'src/awsservice/awsservice.service';
import { UsagePlan } from 'src/usage-plans/entities/usage-plan.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, UsagePlan]),
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
    MailerModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        transport: {
          // For relay SMTP server set the host to smtp-relay.gmail.com
          // and for Gmail STMO server set it to smtp.gmail.com
          host: configService.get<string>('SMTP_HOST'),
          port: configService.get<number>('SMTP_PORT'),
          secure: configService.get<number>('SMTP_PORT') === 465, // true for 465, false for 587
          auth: {
            user: configService.get<string>('SMTP_USER'),
            pass: configService.get<string>('SMTP_PASS'),
          },
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(), // or new PugAdapter() or new EjsAdapter()
          options: {
            strict: true,
          },
        },
        defaults: {
          from: '"No Reply" <noreply@histori.xyz>',
        },
      }),
      inject: [ConfigService],
    }),
    HttpModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OAuthService,
    MailService,
    JwtService,
    PaymentsService,
    AWSService,
  ],
})
export class AuthModule {}
