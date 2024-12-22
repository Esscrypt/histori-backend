import {
  Controller,
  Post,
  Put,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { QuicknodeService } from './quicknode.service';
import { BasicAuthGuard } from './guards/basic-auth.guard';

@ApiTags('QuickNode')
@Controller('quicknode')
@UseGuards(BasicAuthGuard)
export class QuicknodeController {
  constructor(private readonly quicknodeService: QuicknodeService) {}

  @Post('provision')
  @ApiOperation({ summary: 'Provision a service for a customer' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service provisioned successfully.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Service already provisioned.',
  })
  @HttpCode(HttpStatus.OK)
  provision(@Body() data: any) {
    return this.quicknodeService.provisionService(data);
  }

  @Put('update')
  @ApiOperation({ summary: 'Update a provisioned service' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service updated successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Service not found.',
  })
  @HttpCode(HttpStatus.OK)
  update(@Body() data: any) {
    return this.quicknodeService.updateService(data);
  }

  @Get('healthcheck')
  @ApiOperation({ summary: 'Healthcheck' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Healthcheck successfull.',
  })
  @HttpCode(HttpStatus.OK)
  healthcheck() {
    return this.quicknodeService.healthCheck();
  }

  @Delete('deactivate')
  @ApiOperation({ summary: 'Deactivate a specific endpoint' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Endpoint deactivated successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Endpoint or service not found.',
  })
  @HttpCode(HttpStatus.OK)
  deactivate(@Body() data: any) {
    return this.quicknodeService.deactivateService(data);
  }

  @Delete('deprovision')
  @ApiOperation({ summary: 'Deprovision a customer’s service' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service deprovisioned successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Service not found.',
  })
  @HttpCode(HttpStatus.OK)
  deprovision(@Body() data: any) {
    return this.quicknodeService.deprovisionService(data);
  }
}
