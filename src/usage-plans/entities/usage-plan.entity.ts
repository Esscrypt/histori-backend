// usage-plans/entities/usage-plan.entity.ts
import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class UsagePlan {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  stripeLookupKeyMonthly: string;

  @Column({ nullable: true })
  stripeLookupKeyYearly: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  priceMonthly?: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  priceYearly?: number;

  @Column({ type: 'int', nullable: true })
  requestsPerMonth?: number;

  @Column({ type: 'int', nullable: true })
  requestsPerSecond?: number;

  @Column({ type: 'int', nullable: true })
  burstRequestsPerSecond?: number;
}
