import {it,expect} from 'vitest';
import {catalogueUrls,foreverSlug} from '../src/lib/forever-catalogue';
it('uses only the canonical listed manifest links and deduplicates repeated references',()=>{
 const url='https://playforever.app/games/runners/forever.json';
 expect(catalogueUrls(`${url}\n${url}\nhttps://attacker.test/games/runners/forever.json`)).toEqual(['https://playforever.app/games/runners']);
 expect(()=>catalogueUrls('no manifests')).toThrow();
});
it('retains historical identity across the two prior Forever origins and renamed Tuk Tuk Rush',()=>{
 expect(foreverSlug('https://forever.138-68-247-33.sslip.io/games/bible-learning')).toBe('bible-learning');
 expect(foreverSlug('https://forever.africa/games/keke-smash')).toBe('tuk-tuk-rush');
 expect(foreverSlug('https://playforever.app/games/tuk-tuk-rush')).toBe('tuk-tuk-rush');
 expect(foreverSlug('https://attacker.test/games/runners')).toBeUndefined();
});
