import { Test } from '@nestjs/testing';
import { IngestController } from './ingest.controller';
import { IngestQueue } from './ingest.queue';
import { IngestRateLimitService } from '../../shared/rate-limit/ingest-rate-limit.service';
import { ApiKeyGuard, API_KEY_PROJECT } from '../../shared/guards/api-key.guard';

const mockQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
});

const mockRateLimit = () => ({
  checkAndIncrement: jest.fn().mockResolvedValue(undefined),
});

describe('IngestController', () => {
  let controller: IngestController;
  let queue: ReturnType<typeof mockQueue>;
  let rateLimit: ReturnType<typeof mockRateLimit>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [IngestController],
      providers: [
        { provide: IngestQueue, useFactory: mockQueue },
        { provide: IngestRateLimitService, useFactory: mockRateLimit },
      ],
    })
      .overrideGuard(ApiKeyGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(IngestController);
    queue = module.get(IngestQueue);
    rateLimit = module.get(IngestRateLimitService);
  });

  function createReq(projectId = 'p1'): any {
    return { [API_KEY_PROJECT]: { id: projectId } };
  }

  function createDto(eventCount: number): any {
    return {
      sessionId: 's1',
      events: Array.from({ length: eventCount }, (_, i) => ({
        id: `e${i}`, sessionId: 's1', timestamp: Date.now(), type: 'click', url: 'http://x', payload: {},
      })),
    };
  }

  it('accepts batch and queues job', async () => {
    const dto = createDto(5);
    const result = await controller.batch(createReq(), 'production', dto);

    expect(result.accepted).toBe(true);
    expect(result.queued).toBe(5);
    expect(queue.add).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      sessionId: 's1',
      environmentName: 'production',
      events: expect.any(Array),
    }));
    expect(rateLimit.checkAndIncrement).toHaveBeenCalledWith('p1');
  });

  it('uses null environment when header is missing', async () => {
    const dto = createDto(1);
    const result = await controller.batch(createReq(), undefined, dto);

    expect(result.accepted).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(expect.objectContaining({
      environmentName: null,
    }));
  });

  it('caps events at 100', async () => {
    const dto = createDto(150);
    const result = await controller.batch(createReq(), undefined, dto);

    expect(result.queued).toBe(100);
    expect(queue.add).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.arrayContaining([expect.any(Object)]),
    }));
    const call = queue.add.mock.calls[0][0];
    expect(call.events.length).toBe(100);
  });

  it('rejects payload over 512KB', async () => {
    const largePayload = 'x'.repeat(600_000);
    const dto = {
      sessionId: 's1',
      events: [{ id: 'e1', sessionId: 's1', timestamp: 1, type: 'click', url: 'http://x', payload: { data: largePayload } }],
    };

    const result = await controller.batch(createReq(), undefined, dto);

    expect(result.error).toBe('Payload too large');
    expect(result.maxBytes).toBe(512_000);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('calls rate limiter before processing', async () => {
    rateLimit.checkAndIncrement.mockRejectedValue(new Error('Rate limit exceeded'));
    const dto = createDto(1);

    await expect(controller.batch(createReq(), undefined, dto)).rejects.toThrow('Rate limit exceeded');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
