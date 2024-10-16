// usage-plans/entities/usage-plan.entity.ts
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class UsagePlan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  stripeProductId?: string;

  @Column('decimal', { precision: 10, scale: 2 })
  priceMonthly: number;

  @Column('decimal', { precision: 10, scale: 2 })
  priceYearly: number;

  @Column({ type: 'int', nullable: true })
  requestsPerMonth?: number;

  @Column({ type: 'int', nullable: true })
  requestsPerSecond?: number;

  @Column({ type: 'int', nullable: true })
  burstRequestsPerSecond?: number;
}
