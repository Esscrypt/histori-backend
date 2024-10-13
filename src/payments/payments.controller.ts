import {
  Controller,
  Post,
  Body,
  Res,
  HttpStatus,
  Req,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedRequest } from 'src/types/express';
import { TokenAuthGuard } from 'src/auth/guards/auth.guard';

class CreateCheckoutSessionDto {
  lookup_key: string;
}

@ApiTags('Stripe') // This groups your endpoints under "Stripe" in Swagger UI
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-checkout-session')
  @ApiOperation({ summary: 'Create a checkout session' })
  @ApiResponse({
    status: 201,
    description: 'Checkout session created successfully',
  })
  @ApiResponse({ status: 404, description: 'No prices found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @UseGuards(TokenAuthGuard) // Protect the endpoint with the AuthGuard
  async createCheckoutSession(
    @Body() createCheckoutSessionDto: CreateCheckoutSessionDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    try {
      const { lookup_key } = createCheckoutSessionDto;
      console.log('User Info:', req.user); // Log user to verify structure
      const userId = req.user.userId as number;
      this.logger.log('userId', userId);
      const sessionUrl = await this.paymentsService.createCheckoutSession(
        lookup_key,
        userId,
      );
      return res.json({ url: sessionUrl });
    } catch (error: any) {
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: error.message });
    }
  }

  @Post('create-portal-session')
  @ApiOperation({ summary: 'Create a portal session' })
  @ApiResponse({
    status: 201,
    description: 'Portal session created successfully',
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  @UseGuards(TokenAuthGuard)
  async createPortalSession(
    @Res() res: Response,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user.userId as number;
      const portalUrl = await this.paymentsService.createPortalSession(userId);
      return res.json({ url: portalUrl });
    } catch (error: any) {
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: error.message });
    }
  }
}
