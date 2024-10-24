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

@Injectable()
export class PaymentsService {
  stripeClient: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

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
    const stripeCustomerId = evt.data.object.customer as string;
    const user = await this.findUserByStripeId(stripeCustomerId);

    if (!user) {
      this.logger.warn(`User not found for customer ID: ${stripeCustomerId}`);
      return;
    }

    const newSubscription = evt.data.object;
    const newSubscriptionId = newSubscription.id as string;
    const productId = newSubscription.items.data[0].price.product as string;
    const newTier = this.getTierFromProductId(productId);

    if (user.subscriptionId && user.subscriptionId === newSubscriptionId) {
      this.logger.log(`Subscription already exists for user: ${user.id}`);
      return;
    }

    if (user.tier == newTier) {
      this.logger.log(`User: ${user.id} already has tier: ${newTier}`);
      return;
    }

    // Cancel the previous subscription if it exists
    if (user.subscriptionId) {
      try {
        const oldSubscriptionId = user.subscriptionId;
        // user.subscriptionId = newSubscriptionId;
        // await this.userRepository.save(user);
        await this.stripeClient.subscriptions.cancel(oldSubscriptionId); // Delete the previous subscription
        this.logger.log(
          `Deleted previous subscription: ${user.subscriptionId} for user: ${user.id}`,
        );
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // this.logger.error(
        //   `Failed to delete previous subscription ${user.subscriptionId} for user: ${user.id}`,
        //   error.message,
        // );
      }
    }

    if (!user.apiKeyId) {
      const apiKey = await this.awsService.createAwsApiGatewayKey();
      user.apiKeyId = apiKey.id;
      user.apiKeyValue = apiKey.value;
      this.logger.log(`Created new API key for user: ${user.id}`);
      await this.userRepository.save(user);
    }

    try {
      await this.awsService.associateKeyWithUsagePlan(
        user.apiKeyId,
        user.tier,
        newTier,
      );

      const oldTier = user.tier;

      user.subscriptionId = newSubscriptionId;
      user.tier = newTier;

      user.requestLimit =
        await this.awsService.getTotalRequestCountForUsagePlan(user);
      this.logger.log('new request limit:', user.requestLimit);

      await this.handleReferralBonus(user, newSubscription);

      await this.userRepository.save(user);

      this.logger.log(
        `Updated usage plan for user: ${user.id} from ${oldTier} to ${newTier}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update usage plan for user: ${user.id}`,
        error.message,
      );
    }
  }

  @StripeWebhookHandler('customer.subscription.deleted')
  async handleSubscriptionDeleted(
    evt: Stripe.CustomerSubscriptionDeletedEvent,
  ) {
    const subscription = evt.data.object;
    const stripeCustomerId = subscription.customer as string;

    // Find the user associated with the Stripe customer ID
    const user = await this.findUserByStripeId(stripeCustomerId);

    if (!user) {
      this.logger.warn(`User not found for customer ID: ${stripeCustomerId}`);
      return;
    }

    // Check if the deletion was initiated by the backend (event.request is not null)
    if (evt.request) {
      this.logger.log(
        'Subscription cancellation was initiated by backend code or an API call.',
      );
      return;
    } else {
      this.logger.log('Subscription cancellation was initiated by the user.');
    }

    // Handle the deletion (remove API keys, etc.)
    try {
      if (user.apiKeyId) {
        await this.awsService.removeApiKey(user.apiKeyId);
        user.apiKeyId = null;
        user.apiKeyValue = null;
        await this.userRepository.save(user);
        console.log(`Removed API key for user: ${user.id}`);
      }
    } catch (error: any) {
      this.logger.error(
        `Error processing subscription event: ${error.message}`,
      );
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

  //NOTE: This function will be called twice for each subscription event
  private async handleReferralBonus(
    user: User,
    subscription: Stripe.Subscription,
  ): Promise<void> {
    if (user.referrerCode) {
      const referrer = await this.userRepository.findOne({
        where: { referralCode: user.referrerCode },
      });

      if (referrer) {
        const amount = subscription.items.data[0].price.unit_amount;
        const referralBonus = amount * 0.075;
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
