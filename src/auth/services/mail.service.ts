import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendUserConfirmation(email: string, token: string) {
    const url = `${process.env.BASE_URL}/signin?provider=jwt&code=${token}`;
    const year = new Date().getFullYear();
    await this.mailerService.sendMail({
      to: email,
      subject: 'Welcome to Histori! Confirm your Email',
      template: './confirmation', // Path to the .hbs template
      context: {
        url,
        year,
      },
    });
  }

  async sendDeletionConfirmation(email: string, token: string) {
    const url = `${process.env.BASE_URL}/dashboard?deletionToken=${token}`;
    const year = new Date().getFullYear();
    await this.mailerService.sendMail({
      to: email,
      subject: 'We received your request to delete your account',
      template: './deletion', // Path to the .hbs template
      context: {
        url,
        year,
      },
    });
  }

  async sendTrialEndingEmail(email: string) {
    const year = new Date().getFullYear();
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your trial is ending soon',
      template: './trial-ending',
      context: { year },
    });
  }

  async sendPasswordReset(email: string, token: string) {
    const url = `${process.env.BASE_URL}/signup?token=${token}`;
    const year = new Date().getFullYear();
    await this.mailerService.sendMail({
      to: email,
      subject: 'Reset Your Password',
      template: './reset-password', // Path to the .hbs template
      context: {
        url,
        year,
      },
    });
  }

  // New method to send Contact Us form submissions
  async sendContactForm(name: string, email: string, message: string) {
    const year = new Date().getFullYear();
    await this.mailerService.sendMail({
      to: process.env.CONTACT_RECEIVER_EMAIL, // Your email to receive messages
      subject: 'New Contact Us Form Submission',
      template: './contact', // Path to the .hbs template
      context: {
        name,
        email,
        message,
        year,
      },
    });
  }
}
