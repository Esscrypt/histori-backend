import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    description: 'The email address of the user',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Invalid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    description: 'The password for the user, at least 6 characters',
    example: 'StrongPassword123!',
  })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password needs to be at least 6 characters' })
  password: string;

  @ApiPropertyOptional({
    description: 'The referrer id for the user',
  })
  @IsOptional()
  referrer?: string;
}
