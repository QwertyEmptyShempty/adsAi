import { fbGet, fbPost } from '../facebook';

const REFERENCE_PAGE_ID = '162691913591302';
const TARGET_PAGE_IDS = ['1264696190059959', '1265224086672341', '1264418956755902'];

// Distinct Turkish finance-themed names for each target page
const NEW_NAMES: Record<string, string> = {
  '1264696190059959': 'Finans Rehberi',
  '1265224086672341': 'Ekonomi Analiz',
  '1264418956755902': 'Para Dünyası',
};

async function getPageAccessToken(pageId: string): Promise<string | null> {
  const res = await fbGet<{ access_token?: string; error?: any }>(`/${pageId}`, { fields: 'access_token' });
  if (res.ok && res.body.access_token) return res.body.access_token;
  console.warn(`Could not get page access token for ${pageId}:`, JSON.stringify(res.body.error));
  return null;
}

interface ReferencePageData {
  about?: string;
  category?: string;
  website?: string;
  picture?: { data?: { url?: string } };
  cover?: { source?: string };
}

async function main() {
  console.log('Fetching reference page details...');
  const refRes = await fbGet<ReferencePageData & { error?: any }>(`/${REFERENCE_PAGE_ID}`, {
    fields: 'about,category,website,picture.type(large),cover',
  });
  if (!refRes.ok || refRes.body.error) {
    console.error('Failed to fetch reference page:', JSON.stringify(refRes.body.error));
    return;
  }
  const ref = refRes.body;
  console.log('Reference page data:', JSON.stringify(ref, null, 2));

  const pictureUrl = ref.picture?.data?.url;
  const coverUrl = ref.cover?.source;

  for (const pageId of TARGET_PAGE_IDS) {
    console.log(`\n--- Processing page ${pageId} ---`);
    const pageToken = await getPageAccessToken(pageId);
    if (!pageToken) {
      console.error(`Skipping ${pageId}: no page access token.`);
      continue;
    }
    const tokenParam = { access_token: pageToken };

    // 1. Update name, about, category, website
    const updateFields: Record<string, string> = {
      name: NEW_NAMES[pageId] || 'Finans Sayfası',
      access_token: pageToken,
    };
    if (ref.about) updateFields.about = ref.about;
    if (ref.category) updateFields.category = ref.category;
    if (ref.website) updateFields.website = ref.website;

    const updateRes = await fbPost<{ success?: boolean; error?: any }>(`/${pageId}`, updateFields);
    if (updateRes.ok && !updateRes.body.error) {
      console.log(`[${pageId}] Updated name/about/category/website OK.`);
    } else {
      console.error(`[${pageId}] Failed to update fields:`, JSON.stringify(updateRes.body.error));
    }

    // 2. Update profile picture
    if (pictureUrl) {
      const picRes = await fbPost<{ success?: boolean; error?: any }>(`/${pageId}/picture`, {
        url: pictureUrl,
        ...tokenParam,
      });
      if (picRes.ok && !picRes.body.error) {
        console.log(`[${pageId}] Updated profile picture OK.`);
      } else {
        console.error(`[${pageId}] Failed to update picture:`, JSON.stringify(picRes.body.error));
      }
    }

    // 3. Update cover photo: upload the cover image as a photo, then set it as cover
    if (coverUrl) {
      const uploadRes = await fbPost<{ id?: string; error?: any }>(`/${pageId}/photos`, {
        url: coverUrl,
        published: 'false',
        ...tokenParam,
      });
      if (uploadRes.ok && uploadRes.body.id) {
        const coverRes = await fbPost<{ success?: boolean; error?: any }>(`/${pageId}`, {
          cover: JSON.stringify({ photo_id: uploadRes.body.id }),
          ...tokenParam,
        });
        if (coverRes.ok && !coverRes.body.error) {
          console.log(`[${pageId}] Updated cover photo OK.`);
        } else {
          console.error(`[${pageId}] Failed to set cover:`, JSON.stringify(coverRes.body.error));
        }
      } else {
        console.error(`[${pageId}] Failed to upload cover photo:`, JSON.stringify(uploadRes.body.error));
      }
    }
  }

  console.log('\nDone filling pages.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
