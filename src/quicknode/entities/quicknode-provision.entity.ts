import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('quicknode_provision')
export class QuicknodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quicknode_id', unique: true })
  quicknodeId: string;

  @Column({ name: 'endpoint_id' })
  endpointId: string;

  @Column({ name: 'wss_url' })
  wssUrl: string;

  @Column({ name: 'http_url' })
  httpUrl: string;

  @Column('text', { array: true, nullable: true })
  referers: string[];

  @Column('text', { array: true, nullable: true })
  contractAddresses: string[];

  @Column()
  chain: string;

  @Column()
  network: string;

  @Column()
  plan: string;
}
