import {beforeAll,afterAll,it,expect} from 'vitest';
import * as db from '../src/lib/db';import {GET} from '../src/app/api/forever/sdk-config/route';
beforeAll(()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';});afterAll(async()=>db.closeDatabase());
it('publishes only current origin-scoped public keys from the configured workspace',async()=>{
 process.env.FOREVER_OBSERVABILITY_WORKSPACE_ID='owner';
 const game={id:'one',sdkKey:'sdk_public_registry_key_12345',url:'https://playforever.app/games/runners',origins:['https://playforever.app'],foreverCatalogue:{state:'listed',slug:'runners'},privateField:'must-not-leak'};
 await db.put('owner','game',game);await db.put('other','game',{...game,id:'other',sdkKey:'sdk_other_workspace_key_12345'});
 await db.put('owner','game',{...game,id:'retired',foreverCatalogue:{state:'retired',slug:'ludo'}});
 const result=await(await GET()).json();expect(result).toEqual({origin:'https://playforever.app',games:[{slug:'runners',sdkKey:game.sdkKey}]});expect(JSON.stringify(result)).not.toContain('must-not-leak');
 await db.put('owner','game',{...game,id:'duplicate'});expect((await GET()).status).toBe(503);
 delete process.env.FOREVER_OBSERVABILITY_WORKSPACE_ID;expect((await GET()).status).toBe(503);
});
