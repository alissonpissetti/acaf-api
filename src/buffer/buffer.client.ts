import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BufferCreatePostInput,
  BufferEditPostInput,
  BufferMutationResult,
  BufferPostSnapshot,
} from './buffer.types';

const BUFFER_API_URL = 'https://api.buffer.com';

@Injectable()
export class BufferClient {
  private readonly logger = new Logger(BufferClient.name);

  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return Boolean(this.apiKey());
  }

  private apiKey(): string | null {
    const key = this.config.get<string>('BUFFER_API_KEY')?.trim();
    return key || null;
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const key = this.apiKey();
    if (!key) throw new Error('BUFFER_API_KEY não configurada.');

    const response = await fetch(BUFFER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      const retry = response.headers.get('Retry-After') ?? '60';
      throw new Error(`Buffer: limite de requisições. Tente novamente em ${retry}s.`);
    }

    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (!response.ok || body.errors?.length) {
      const msg = body.errors?.map((e) => e.message).join(' · ') || `HTTP ${response.status}`;
      this.logger.warn(`Buffer GraphQL: ${msg}`);
      throw new Error(msg);
    }

    return body.data as T;
  }

  private parsePostPayload(payload: unknown): BufferMutationResult {
    const row = payload as Record<string, unknown>;
    if (row?.post && typeof row.post === 'object') {
      return { ok: true, post: row.post as BufferPostSnapshot };
    }
    const message = typeof row?.message === 'string' ? row.message : 'Erro desconhecido no Buffer.';
    return { ok: false, message };
  }

  async createPost(input: BufferCreatePostInput): Promise<BufferMutationResult> {
    const query = `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id status dueAt externalLink error { message } channelService } }
          ... on MutationError { message }
        }
      }
    `;
    const data = await this.graphql<{ createPost: unknown }>(query, { input });
    return this.parsePostPayload(data.createPost);
  }

  async editPost(input: BufferEditPostInput): Promise<BufferMutationResult> {
    const query = `
      mutation EditPost($input: EditPostInput!) {
        editPost(input: $input) {
          ... on PostActionSuccess { post { id status dueAt externalLink error { message } channelService } }
          ... on MutationError { message }
        }
      }
    `;
    const data = await this.graphql<{ editPost: unknown }>(query, { input });
    return this.parsePostPayload(data.editPost);
  }

  async getPost(postId: string): Promise<BufferPostSnapshot | null> {
    const query = `
      query GetPost($id: ID!) {
        post(input: { id: $id }) {
          id
          status
          dueAt
          externalLink
          error { message }
          channelService
        }
      }
    `;
    const data = await this.graphql<{ post: BufferPostSnapshot | null }>(query, { id: postId });
    return data.post ?? null;
  }

  async deletePost(postId: string): Promise<BufferMutationResult> {
    const query = `
      mutation DeletePost($id: ID!) {
        deletePost(input: { id: $id }) {
          ... on PostActionSuccess { post { id status } }
          ... on MutationError { message }
        }
      }
    `;
    const data = await this.graphql<{ deletePost: unknown }>(query, { id: postId });
    return this.parsePostPayload(data.deletePost);
  }
}