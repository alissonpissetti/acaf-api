export type BufferSchedulingType = 'automatic' | 'notification';

export type BufferPostMode =
  | 'addToQueue'
  | 'customScheduled'
  | 'shareNow';

export type BufferAssetInput = {
  image?: {
    url: string;
    metadata?: { altText?: string };
  };
  video?: {
    url: string;
    metadata?: { thumbnailOffset?: number };
  };
};

export type BufferCreatePostInput = {
  channelId: string;
  text?: string;
  schedulingType: BufferSchedulingType;
  mode?: BufferPostMode;
  dueAt?: string;
  saveToDraft?: boolean;
  assets?: BufferAssetInput[];
  metadata?: {
    instagram?: {
      type?: 'post' | 'story' | 'reel';
      shouldShareToFeed?: boolean;
      link?: string;
    };
    facebook?: { type?: 'post' | 'story' };
  };
};

export type BufferEditPostInput = Partial<BufferCreatePostInput> & {
  postId: string;
};

export type BufferPostSnapshot = {
  id: string;
  status: string;
  dueAt?: string | null;
  externalLink?: string | null;
  error?: { message?: string } | null;
  channelService?: string | null;
};

export type BufferMutationResult =
  | { ok: true; post: BufferPostSnapshot }
  | { ok: false; message: string };