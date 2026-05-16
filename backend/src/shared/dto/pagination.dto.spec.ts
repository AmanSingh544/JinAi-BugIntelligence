import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationDto } from './pagination.dto';

describe('PaginationDto', () => {
  it('uses defaults when empty', async () => {
    const dto = plainToInstance(PaginationDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('accepts valid page and limit', async () => {
    const dto = plainToInstance(PaginationDto, { page: 3, limit: 50 });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(50);
  });

  it('rejects limit over 100', async () => {
    const dto = plainToInstance(PaginationDto, { limit: 200 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects page below 1', async () => {
    const dto = plainToInstance(PaginationDto, { page: 0 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
