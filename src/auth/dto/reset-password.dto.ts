import { IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'The email password reset token sent to the user',
    example: 'd8f56b21-e0a8-4db0-9f91-8328907b6274',
  })
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: 'New Password of the user',
    example: 'password123',
  })
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}
