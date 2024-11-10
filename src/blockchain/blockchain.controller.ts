import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BlockchainService } from './blockchain.service';
import { TokenAuthGuard } from 'src/auth/guards/auth.guard';

@ApiTags('Blockchain')
@ApiBearerAuth()
@UseGuards(TokenAuthGuard)
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  /**
   * @api {get} /blockchain/hst-balance Get HST Balance
   * @apiDescription Retrieve the current HST balance for a specific user
   * @apiParam {string} web3Address The web3 address of the user
   * @apiSuccess {number} balance The HST balance of the user
   */
  @Get('hst-balance')
  @ApiOperation({ summary: 'Get HST balance for a user' })
  @ApiResponse({
    status: 200,
    description: 'Returns the HST balance for a user',
  })
  @ApiResponse({ status: 400, description: 'Invalid web3 address' })
  async getHstBalance(@Query('web3Address') web3Address: string) {
    if (!web3Address) {
      throw new BadRequestException('web3Address query parameter is required');
    }
    const balance = await this.blockchainService.fetchHstBalance(web3Address);
    return { balance };
  }

  /**
   * @api {get} /blockchain/hst-usd-price Get HST to USD Price
   * @apiDescription Retrieve the current HST token price in USD
   * @apiSuccess {number} price The current price of HST in USD
   */
  @Get('hst-usd-price')
  @ApiOperation({ summary: 'Get current HST to USD price' })
  @ApiResponse({
    status: 200,
    description: 'Returns the current HST to USD price',
  })
  async getHstToUsdPrice() {
    const price = await this.blockchainService.fetchCurrentHSTPriceInUSD();
    return { price };
  }
}
