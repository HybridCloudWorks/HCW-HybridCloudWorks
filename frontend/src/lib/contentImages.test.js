import { describe, it, expect } from 'vitest';
import {
  getOrderedContentImageUrls,
  buildContentImageFieldsFromOrderedUrls,
  buildContentImageDocUpdate,
} from './contentImages';

describe('contentImages', () => {
  it('deduplicates and preserves image priority order', () => {
    const item = {
      heroImageUrl: 'https://img.example/hero.png',
      altCoverImage: 'https://img.example/hero.png',
      contentImageUrl: 'https://img.example/content.png',
      secondaryImageUrls: [
        'https://img.example/secondary-1.png',
        'https://img.example/secondary-2.png',
      ],
      aiImageUrls: {
        hero: 'https://img.example/hero.png',
        secondary1: 'https://img.example/secondary-1.png',
        secondary2: 'https://img.example/secondary-2.png',
        content: 'https://img.example/content.png',
      },
    };

    expect(getOrderedContentImageUrls(item)).toEqual([
      'https://img.example/hero.png',
      'https://img.example/content.png',
      'https://img.example/secondary-1.png',
      'https://img.example/secondary-2.png',
    ]);
  });

  it('preserves aiImageUrls.content when it remains in the ordered set', () => {
    const result = buildContentImageFieldsFromOrderedUrls(
      [
        'https://img.example/hero.png',
        'https://img.example/secondary-1.png',
        'https://img.example/content.png',
      ],
      {
        aiImageUrls: {
          content: 'https://img.example/content.png',
        },
      }
    );

    expect(result).toEqual({
      heroImageUrl: 'https://img.example/hero.png',
      contentImageUrl: 'https://img.example/hero.png',
      altCoverImage: 'https://img.example/hero.png',
      secondaryImageUrls: [
        'https://img.example/secondary-1.png',
        'https://img.example/content.png',
      ],
      aiImageUrls: {
        hero: 'https://img.example/hero.png',
        secondary1: 'https://img.example/secondary-1.png',
        secondary2: 'https://img.example/content.png',
        content: 'https://img.example/content.png',
      },
    });
  });

  it('uses delete sentinels when the ordered set is empty', () => {
    const deleteFieldValue = () => '__DELETE__';

    expect(buildContentImageDocUpdate([], {}, deleteFieldValue)).toEqual({
      heroImageUrl: '__DELETE__',
      contentImageUrl: '__DELETE__',
      altCoverImage: '__DELETE__',
      secondaryImageUrls: '__DELETE__',
      aiImageUrls: {},
    });
  });
});
