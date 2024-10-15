import {
  InjectStripeClient,
  StripeWebhookHandler,
} from '@golevelup/nestjs-stripe';
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/auth/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { MailService } from 'src/auth/services/mail.service';
import { AWSService } from 'src/awsservice/awsservice.service';

import { Mutex } from 'async-mutex';


@Injectable()
export class PaymentsService {
  stripeClient: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  // In-memory map to store processed event IDs
  private processedEvents: Map<string, any> = new Map();

  // Mutex for locking
  private mutex: Mutex = new Mutex();

  constructor(
    @InjectStripeClient() stripeClient: Stripe,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private configService: ConfigService,
    private readonly mailService: MailService,
    private readonly awsService: AWSService, // Inject AWSService
  ) {
    this.stripeClient = stripeClient;
  }

  @StripeWebhookHandler('customer.subscription.created')
  async handleSubscriptionCreated(
    evt: Stripe.CustomerSubscriptionCreatedEvent,
  ) {
      const stripeEventId = evt.id; // Stripe event ID

      const stripeCustomerId = evt.data.object.customer as string;
      const user = await this.findUserByStripeId(stripeCustomerId);

      if (!user) {
        this.logger.warn(`User not found for customer ID: ${stripeCustomerId}`);
        return;
      }

      try {
        const subscription = evt.data.object;
        const productId = subscription.items.data[0].price.product as string;
        const tier = this.getTierFromProductId(productId);

        user.tier = tier;
        user.requestCount = 0; // Reset request count
        this.setRequestLimitForTier(user, tier);
        this.logger.log(`Updated user: ${user.id} to tier: ${tier}`);

        // Provision AWS VPS for the user
        if (user.useDedicatedServer && !user.serverProvisioned) {
          const vpsIp = await this.awsService.provisionAwsVps(user);
          user.serverIp = vpsIp;
          user.serverProvisioned = true;
          this.logger.log(`Assigned VPS IP: ${vpsIp} to user: ${user.id}`);
        }

        if (!user.useDedicatedServer) {
          user.apiKey = await this.awsService.createAwsApiGatewayKey(user);
          this.logger.log(`Assigned AWS API Key: ${user.apiKey} to user: ${user.id}`);
        }

        await this.handleReferralBonus(user, subscription);

        await this.userRepository.save(user);
      } catch (error: any) {
        this.logger.error(`Error processing subscription event: ${error.message}`);
      }

  }


  private async handleReferralBonus(
    user: User,
    subscription: Stripe.Subscription,
  ): Promise<void> {
    if (user.referrerCode) {
      const referrer = await this.userRepository.findOne({
        where: { referralCode: user.referrerCode },
      });

      if (referrer) {
        const amount = subscription.items.data[0].price.unit_amount / 100;
        const referralBonus = amount * 0.15;
        referrer.referralPoints += referralBonus;
        await this.userRepository.save(referrer);
        this.logger.log(
          `Added ${referralBonus} points to referrer: ${referrer.email}`,
        );
      } else {
        this.logger.warn(`Referrer not found for code: ${user.referrerCode}`);
      }
    }
  }

  // Handle subscription deletion with VPS teardown
  @StripeWebhookHandler('customer.subscription.deleted')
  async handleSubscriptionDeleted(
    evt: Stripe.CustomerSubscriptionDeletedEvent,
  ) {
    const stripeCustomerId = evt.data.object.customer as string;
    const user = await this.findUserByStripeId(stripeCustomerId);

    if (user) {
      // Downgrade to 'Free' tier
      user.tier = 'Free';
      this.setRequestLimitForTier(user, 'Free');
      await this.userRepository.save(user);

      this.logger.log(
        `Subscription deleted for user: ${user.email}, downgraded to Free tier.`,
      );
      if (user.serverProvisioned) {
        // Teardown AWS VPS for this user using their user ID
        await this.awsService.teardownAwsVps(user);
        user.serverProvisioned = false;
        user.serverIp = '';
        await this.userRepository.save(user);
      }
    }
  }

  @StripeWebhookHandler('customer.subscription.trial_will_end')
  async handleTrialWillEnd(evt: Stripe.CustomerSubscriptionTrialWillEndEvent) {
    const stripeCustomerId = evt.data.object.customer as string;
    const user = await this.findUserByStripeId(stripeCustomerId);

    if (user) {
      await this.mailService.sendTrialEndingEmail(user.email);
      this.logger.log(`Trial ending email sent to user: ${user.email}`);
    } else {
      this.logger.warn(`User not found for customer ID: ${stripeCustomerId}`);
    }
  }

  private setRequestLimitForTier(user: User, tier: string): void {
    const limits = {
      Free: 5000,
      Starter: 50000,
      Growth: 300000,
      Business: 700000,
    };
    user.requestLimit = limits[tier] || 5000;
  }
  // Map product IDs to tiers
  private getTierFromProductId(productId: string): string {
    const tierMap = {
      prod_Qm8v7qrPXe57FY: 'Starter',
      prod_Qs8muZH1YGmilO: 'Growth',
      prod_Qs8nm4g18RXJmY: 'Business',
    };
    return tierMap[productId] || 'Free';
  }

  // Create a checkout session with Stripe
  public async createCheckoutSession(
    lookup_key: string,
    userId: number,
  ): Promise<string> {
    try {
      this.logger.log(
        `Creating checkout session for lookup key: ${lookup_key}`,
      );

      const clientId = await this.getStripeClientIdByUserId(userId);
      if (!clientId) {
        throw new Error('Client ID not found');
      }

      const prices = await this.stripeClient.prices.list({
        lookup_keys: [lookup_key],
        expand: ['data.product'],
      });

      if (prices.data.length === 0) {
        throw new Error('No prices found');
      }

      const session = await this.stripeClient.checkout.sessions.create({
        customer: clientId,
        billing_address_collection: 'auto',
        line_items: [
          {
            price: prices.data[0].id,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${this.configService.get<string>(
          'BASE_URL',
        )}?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.configService.get<string>(
          'BASE_URL',
        )}?canceled=true`,
      });

      return session.url || '';
    } catch (error: any) {
      this.logger.error(`Error creating checkout session: ${error.message}`);
      throw new Error('Failed to create checkout session');
    }
  }

  // Create a portal session
  public async createPortalSession(userId: number): Promise<string> {
    try {
      this.logger.log(`Creating portal session for userId: ${userId}`);

      const clientId = await this.getStripeClientIdByUserId(userId);
      if (!clientId) {
        throw new Error('Client ID not found');
      }

      const portalSession =
        await this.stripeClient.billingPortal.sessions.create({
          customer: clientId,
          return_url: this.configService.get<string>('BASE_URL'),
        });

      return portalSession.url;
    } catch (error: any) {
      this.logger.error(`Error creating portal session: ${error.message}`);
      throw new Error('Failed to create portal session');
    }
  }

  // Get Stripe client ID for a user
  private async getStripeClientIdByUserId(
    userId: number,
  ): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return user?.stripeCustomerId || null;
  }

  private async findUserByStripeId(stripeCustomerId: string): Promise<User> {
    return this.userRepository.findOne({
      where: { stripeCustomerId: stripeCustomerId },
    });
  }

  // Create a Stripe customer and return their ID
  public async createStripeCustomer(email?: string): Promise<string> {
    const customer = await this.stripeClient.customers.create({ email });
    return customer.id;
  }
}
