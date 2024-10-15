import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  BeforeInsert,
  BeforeUpdate,
  AfterLoad,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import * as bcrypt from 'bcryptjs'; // or 'bcryptjs'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsEthereumAddress,
  IsString,
  MinLength,
} from 'class-validator';
import { v4 as uuidv4 } from 'uuid';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  @ApiProperty({ description: 'Unique identifier for the user' })
  id: number;

  @Column({ unique: true, nullable: true })
  githubId: string;

  @Column({ unique: true })
  @ApiProperty({ description: 'Email address of the user', uniqueItems: true })
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @Column({ nullable: true })
  @ApiProperty({ description: 'Password for the user account' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @Column({ default: false })
  @ApiProperty({
    description: 'Whether the user account is active or not',
    default: false,
  })
  isActive: boolean;

  @Column()
  @ApiProperty({ description: 'Stripe customer ID associated with the user' })
  stripeCustomerId: string;

  @Index() // Add index to the apiKey for faster lookup
  @Column({ nullable: true })
  @ApiProperty({ description: 'API key for the user to access APIs' })
  apiKey?: string;

  @Column({
    type: 'enum',
    enum: ['Free', 'Starter', 'Growth', 'Business', 'Enterprise'],
    default: 'Free',
  })
  @ApiProperty({
    description: 'API tier assigned to the user',
    enum: ['Free', 'Starter', 'Growth', 'Business', 'Enterprise'],
    default: 'Free',
  })
  @IsEnum(['Free', 'Starter', 'Growth', 'Business', 'Enterprise'], {
    message:
      'Tier must be one of the following: Free, Starter, Growth, Business, Enterprise',
  })
  tier: string;

  @Column({ default: 0 })
  requestCount: number;

  @Column({ default: 5000 })
  @ApiProperty({
    description: 'Custom rate limit for the user. Meant for enterprise users.',
  })
  requestLimit: number;

  @Column({ nullable: true })
  @ApiPropertyOptional({
    description: 'Ethereum wallet address associated with the user',
  })
  @IsOptional()
  @IsEthereumAddress({ message: 'Invalid Ethereum wallet address' })
  web3Address?: string;

  @Column({ default: 'us-east-1' })
  @ApiPropertyOptional({
    description: 'Instance location for the API server',
  })
  instanceLocation: string;

  @Column({ unique: true })
  @ApiProperty({ description: 'Referral code for the user to refer others' })
  referralCode: string;

  @Column({ nullable: true })
  @ApiPropertyOptional({ description: 'Referral code of the referrer' })
  referrerCode?: string;

  @Column({ default: 0 })
  @ApiProperty({ description: 'Referral points accumulated by the user' })
  referralPoints: number;

  @CreateDateColumn()
  @ApiProperty({ description: 'The date the user was created' })
  createdAt: Date;

  @Column({ nullable: true })
  @ApiPropertyOptional({
    description: 'Current Stripe subscription ID for the user',
  })
  subscriptionId?: string;  // Store the current active subscription ID

  @Column({ nullable: true })
  lastIdempotencyKey?: string;

  private tempPassword: string;

  @AfterLoad()
  private loadTempPassword(): void {
    this.tempPassword = this.password;
  }

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.tempPassword !== this.password) {
      const saltRounds = parseInt(process.env.SALT_ROUNDS || '10', 10);
      this.password = await bcrypt.hash(this.password, saltRounds);
    }
  }

  @BeforeInsert()
  generateReferralCode() {
    this.referralCode = `${uuidv4()}`;
  }

  async comparePassword(enteredPassword: string): Promise<boolean> {
    return await bcrypt.compare(enteredPassword, this.password);
  }

  async compareApiKey(providedApiKey: string): Promise<boolean> {
    return this.apiKey === providedApiKey;
  }
}
