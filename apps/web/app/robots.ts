import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Search crawlers must be able to read the admin noindex response.
      { userAgent: '*', allow: '/' },
      {
        userAgent: [
          'GPTBot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'ClaudeBot',
          'Claude-SearchBot',
          'Claude-User',
          'Google-Extended',
          'CCBot',
          'Bytespider',
          'PerplexityBot',
          'Perplexity-User',
        ],
        disallow: ['/admin$', '/admin/', '/admin?'],
      },
    ],
  };
}
