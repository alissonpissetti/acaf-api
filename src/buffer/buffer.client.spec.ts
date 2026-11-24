import { ConfigService } from '@nestjs/config';
import { BufferClient } from './buffer.client';

describe('BufferClient', () => {
  it('fails without api key', async () => {
    const client = new BufferClient({
      get: () => undefined,
    } as unknown as ConfigService);
    await expect(client.createPost({
      channelId: 'x',
      schedulingType: 'automatic',
      mode: 'addToQueue',
    })).rejects.toThrow('BUFFER_API_KEY');
  });
});