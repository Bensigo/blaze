import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({config:undefined as any}));
vi.mock('@aws-sdk/client-s3',()=>({
  S3Client:class { constructor(config:unknown){h.config=config;} async send(){return {};} },
  HeadObjectCommand:class {}, PutObjectCommand:class {}, GetObjectCommand:class {}, DeleteObjectCommand:class {}, CopyObjectCommand:class {},
}));
import { neonHead, neonStorageConfigured } from '../src/lib/neon-storage';
const all=['NEON_STORAGE_ENDPOINT','NEON_STORAGE_REGION','NEON_STORAGE_ACCESS_KEY_ID','NEON_STORAGE_SECRET_ACCESS_KEY','NEON_STORAGE_BUCKET','AWS_ENDPOINT_URL_S3','AWS_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'];
function aws(){vi.stubEnv('AWS_ENDPOINT_URL_S3','https://legacy.example');vi.stubEnv('AWS_REGION','legacy-region');vi.stubEnv('AWS_ACCESS_KEY_ID','legacy-id');vi.stubEnv('AWS_SECRET_ACCESS_KEY','legacy-secret');vi.stubEnv('NEON_STORAGE_BUCKET','private');}
function custom(){vi.stubEnv('NEON_STORAGE_ENDPOINT','https://custom.example');vi.stubEnv('NEON_STORAGE_REGION','custom-region');vi.stubEnv('NEON_STORAGE_ACCESS_KEY_ID','custom-id');vi.stubEnv('NEON_STORAGE_SECRET_ACCESS_KEY','custom-secret');}
describe('Neon storage configuration',()=>{
  beforeEach(()=>{for(const name of all)vi.stubEnv(name,undefined);h.config=undefined;});
  afterEach(()=>vi.unstubAllEnvs());
  it('uses the complete custom set even when platform AWS settings exist',async()=>{
    aws();custom();expect(neonStorageConfigured()).toBe(true);await neonHead('fixture');
    expect(h.config).toMatchObject({endpoint:'https://custom.example/',region:'custom-region',credentials:{accessKeyId:'custom-id',secretAccessKey:'custom-secret'},forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED'});
  });
  it('fails closed on partial or empty custom settings despite complete AWS settings',async()=>{
    aws();vi.stubEnv('NEON_STORAGE_ENDPOINT','https://custom.example');
    expect(neonStorageConfigured()).toBe(false);await expect(neonHead('fixture')).rejects.toThrow('not configured');expect(h.config).toBeUndefined();
    custom();vi.stubEnv('NEON_STORAGE_SECRET_ACCESS_KEY','');expect(neonStorageConfigured()).toBe(false);
  });
  it('accepts the complete explicit legacy AWS set when no custom connection setting exists',async()=>{
    aws();expect(neonStorageConfigured()).toBe(true);await neonHead('fixture');
    expect(h.config).toMatchObject({endpoint:'https://legacy.example/',region:'legacy-region',credentials:{accessKeyId:'legacy-id',secretAccessKey:'legacy-secret'},requestChecksumCalculation:'WHEN_REQUIRED'});
    vi.stubEnv('AWS_ENDPOINT_URL_S3',undefined);expect(neonStorageConfigured()).toBe(false);
  });
});
