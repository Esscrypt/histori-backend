export class ContactDto {
  email: string;
  name: string;
  message: string;
  captchaToken: string; // Google reCAPTCHA token
}
