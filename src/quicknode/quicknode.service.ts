import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { QuicknodeEntity } from './entities/quicknode-provision.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/auth/entities/user.entity';

@Injectable()
export class QuicknodeService {
  private readonly logger = new Logger(QuicknodeService.name);

  constructor(
    @InjectRepository(QuicknodeEntity)
    private readonly quicknodeRepository: Repository<QuicknodeEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}
  async provisionService(data: any): Promise<any> {
    this.logger.log(data);
    const { 'quicknode-id': quicknodeId } = data;

    const existingService = await this.quicknodeRepository.findOne({
      where: { quicknodeId },
    });

    if (existingService) {
      throw new HttpException(
        'Service already provisioned',
        HttpStatus.CONFLICT,
      );
    }

    const newService = this.quicknodeRepository.create({
      quicknodeId,
      endpointId: data['endpoint-id'],
      wssUrl: data['wss-url'],
      httpUrl: data['http-url'],
      referers: data.referers || [],
      contractAddresses: data.contract_addresses || [],
      chain: data.chain,
      network: data.network,
      plan: data.plan,
    });

    await this.quicknodeRepository.save(newService);

    return {
      status: 'success',
      'dashboard-url': 'http://histori.xyz/provider=jwt&code=',
      'access-url': `https://docs.histori.xyz/docs/api/histori-multichain-data-api`,
    };
  }

  async updateService(data: any): Promise<any> {
    this.logger.log(data);
    const {
      'quicknode-id': quicknodeId,
      plan,
      referers,
      'contract-addresses': contractAddresses,
    } = data;

    const existingService = await this.quicknodeRepository.findOne({
      where: { quicknodeId },
    });

    if (!existingService) {
      return { status: 'error' };
    }

    // Update fields
    existingService.plan = plan || existingService.plan;
    existingService.referers = referers || existingService.referers;
    existingService.contractAddresses =
      contractAddresses || existingService.contractAddresses;

    await this.quicknodeRepository.save(existingService);

    // Update User entity fields
    const user = await this.userRepository.findOne({
      where: { quicknodeId },
    });

    if (user) {
      user.tier = plan;

      await this.userRepository.save(user);
    }

    return { status: 'success' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deactivateService(data: any): any {
    // const { 'quicknode-id': quicknodeId, 'endpoint-id': endpointId } = data;
    // if (!this.services.has(quicknodeId)) {
    //   throw new HttpException('Service not found', HttpStatus.NOT_FOUND);
    // }
    // const service = this.services.get(quicknodeId);
    // if (service['endpoint-id'] !== endpointId) {
    //   throw new HttpException('Endpoint not found', HttpStatus.NOT_FOUND);
    // }
    // this.services.delete(quicknodeId);
    return { status: 'success' };
  }

  async deprovisionService(data: any): Promise<any> {
    const { 'quicknode-id': quicknodeId } = data;

    const user = await this.userRepository.findOne({
      where: { quicknodeId },
    });

    if (user) {
      user.tier = 'None';

      await this.userRepository.save(user);
    } else {
      return { status: 'error' };
    }

    return { status: 'success' };
  }
}
