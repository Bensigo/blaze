import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const names = ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'NEON_STORAGE_BUCKET'] as const;
export function neonStorageConfigured() { return names.every(name => !!process.env[name]?.trim()); }
function config() {
  if (!neonStorageConfigured()) throw new Error('Private Neon storage is not configured');
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL_S3!);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Neon storage endpoint');
  // Presigned PUT has no body at signing time; a default empty-body checksum
  // would reject the actual upload (Neon's documented AWS SDK configuration).
  return { bucket: process.env.NEON_STORAGE_BUCKET!, client: new S3Client({endpoint: endpoint.toString(), region: process.env.AWS_REGION!, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! }}) };
}
export async function neonPut(key: string, bytes: Uint8Array, contentType: string) { const {bucket, client}=config(); await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:contentType})); }
export async function neonDelete(key: string) { const {bucket, client}=config(); await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key})); }
export async function neonCopy(source: string, target: string) { const {bucket, client}=config(); await client.send(new CopyObjectCommand({Bucket:bucket,Key:target,CopySource:`${encodeURIComponent(bucket)}/${source.split('/').map(encodeURIComponent).join('/')}`})); }
export async function neonHead(key: string) { const {bucket, client}=config(); return client.send(new HeadObjectCommand({Bucket:bucket,Key:key})); }
export async function neonRead(key: string, range?: string) { const {bucket, client}=config(); return client.send(new GetObjectCommand({Bucket:bucket,Key:key,Range:range})); }
export async function neonUploadUrl(key: string, contentType: string) { const {bucket, client}=config(); return getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType}),{expiresIn:300}); }
export async function neonDownloadUrl(key: string, filename?: string) { const {bucket, client}=config(); return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:filename ? `attachment; filename="${filename}"` : undefined}),{expiresIn:60}); }
