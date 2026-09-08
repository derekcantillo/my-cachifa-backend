import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  borrowerName?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
