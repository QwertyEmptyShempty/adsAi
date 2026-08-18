import { google } from 'googleapis';

const PARENT_FOLDER_ID = '18nzYWBFVrwUAgI1ZEQx5-oWPP4Gph2xH';
const VIDEO_FOLDER_ID = '1eRh2qQUISFekyzYfoBJKyAFuABXYef3q';

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set');
  }
  const credentials = JSON.parse(keyJson);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
}

function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth: auth as any });
}

export interface DriveFolder {
  id: string;
  name: string;
  createdTime: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

const VIDEO_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm'];

// Port of JS_PickLatestFolder, but per-account alternation state is handled by the caller (mediaState.ts)
// Video always comes from the fixed VIDEO_FOLDER_ID; photo folders are still found by name pattern under the parent.
export async function findCandidateFolders(): Promise<{ videoFolders: DriveFolder[]; photoFolders: DriveFolder[] }> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and name contains 'Адапты Турция'`,
    fields: 'files(id,name,createdTime)',
    pageSize: 200,
  });
  const photoFolders = (res.data.files || []) as DriveFolder[];
  const videoFolders: DriveFolder[] = [
    { id: VIDEO_FOLDER_ID, name: 'Видео (fixed)', createdTime: new Date().toISOString() },
  ];
  return { videoFolders, photoFolders };
}

export function pickLatestFolder(folders: DriveFolder[]): DriveFolder | null {
  if (folders.length === 0) return null;
  return [...folders].sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())[0];
}

export async function findVideoFolder(): Promise<DriveFolder | null> {
  return { id: VIDEO_FOLDER_ID, name: 'Видео (fixed)', createdTime: new Date().toISOString() };
}

export async function listFilesInFolderSortedByNewest(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='video/mp4' or mimeType='video/quicktime')`,
    fields: 'files(id,name,mimeType,createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 200,
  });
  return (res.data.files || []) as (DriveFile & { createdTime?: string })[];
}
export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='video/mp4' or mimeType='video/quicktime')`,
    fields: 'files(id,name,mimeType)',
    pageSize: 200,
  });
  return (res.data.files || []) as DriveFile[];
}

export function isVideoFile(name: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return VIDEO_EXT.includes(ext);
}

export function directDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export async function downloadFileBuffer(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}
