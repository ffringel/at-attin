import { Url } from "url";

interface MastodonPost {
    content: string;
    media_attachments?: Array<{
        type: 'iamge' | 'gifv' | 'video';
        url: string;
        description?: string;
        meta?: { original: {width: number; height: number; duration?: number } };
        preview_url?: string;
    }>;
    card?: {
        url: string;
        title: string;
        description: string;
        image: string;
    };
};

interface ProcessedPost {
    content: string;
    media: string;
    altText: string;
    card: string;
};

interface ProcessMediaResult {
    media: string;
    altTexts: string;
};