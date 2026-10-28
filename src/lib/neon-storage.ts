import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const customNames = ['NEON_STORAGE_ENDPOINT', 'NEON_STORAGE_REGION', 'NEON_STORAGE_ACCESS_KEY_ID', 'NEON_STORAGE_SECRET_ACCESS_KEY'] as const;
const awsNames = ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;
export function neonStorageSelected() { return process.env.NEON_STORAGE_BUCKET !== undefined || customNames.some(name => process.env[name] !== undefined) || !!process.env.AWS_ENDPOINT_URL_S3; }
function settings() {
  // Any explicit custom setting selects the entire custom set, including empty
  // values, so Lambda's ambient AWS credentials can never complete it.
  const names = customNames.some(name => process.env[name] !== undefined) ? customNames : awsNames;
  const values = names.map(name => process.env[name]?.trim());
  const bucket = process.env.NEON_STORAGE_BUCKET?.trim();
  if (!bucket || values.some(value => !value)) return undefined;
  return { endpoint: values[0]!, region: values[1]!, accessKeyId: values[2]!, secretAccessKey: values[3]!, bucket };
}
export function neonStorageConfigured() { return !!settings(); }
function config() {
  const values = settings();
  if (!values) throw new Error('Private Neon storage is not configured');
  const endpoint = new URL(values.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Neon storage endpoint');
  // Presigned PUT has no body at signing time; a default empty-body checksum
  // would reject the actual upload (Neon's documented AWS SDK configuration).
  return { bucket: values.bucket, client: new S3Client({endpoint: endpoint.toString(), region: values.region, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', credentials: { accessKeyId: values.accessKeyId, secretAccessKey: values.secretAccessKey }}) };
}
export async function neonPut(key: string, bytes: Uint8Array, contentType: string) { const {bucket, client}=config(); await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:contentType})); }
export async function neonDelete(key: string) { const {bucket, client}=config(); await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key})); }
export async function neonCopy(source: string, target: string) { const {bucket, client}=config(); await client.send(new CopyObjectCommand({Bucket:bucket,Key:target,CopySource:`${encodeURIComponent(bucket)}/${source.split('/').map(encodeURIComponent).join('/')}`})); }
export async function neonHead(key: string) { const {bucket, client}=config(); return client.send(new HeadObjectCommand({Bucket:bucket,Key:key})); }
export async function neonRead(key: string, range?: string) { const {bucket, client}=config(); return client.send(new GetObjectCommand({Bucket:bucket,Key:key,Range:range})); }
export async function neonUploadUrl(key: string, contentType: string) { const {bucket, client}=config(); return getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:contentType}),{expiresIn:300}); }
export async function neonDownloadUrl(key: string, filename?: string) { const {bucket, client}=config(); return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:filename ? `attachment; filename="${filename}"` : undefined}),{expiresIn:60}); }
