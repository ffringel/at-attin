import { BlobRef } from "@atproto/api";

export interface BotOptions {
    service: string | URL;
    dryRun: boolean;
}

export interface PostContent {
    created_at: string;
    content: string;
    images?: Image[],
    video?: Video,
    card?: Card;
};

export interface Image {
    url: string;
    alt?: string;
}

export interface Video {
    url: string;
    metadata?: VideoMetadata;
}

export interface VideoMetadata {
    width?: number;
    height?: number;
    duration?: number;
    preview_url?: string;
};

export interface Card {
    uri?: string;
    title?: string;
    description?: string;
    image?: string;
  };

export interface MediaUpload {
    blob: BlobRef;
    alt: string;
}