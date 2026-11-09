import { expect, it } from 'vitest';
import { fetchPublic } from '../src/lib/integrations/safe-fetch';
it.each(['http://127.0.0.1/game', 'http://10.0.0.1/game', 'http://169.254.169.254/game', 'http://localhost/game', 'http://[::1]/game'])('rejects private address %s', async url => {
  await expect(fetchPublic(url, 0)).rejects.toThrow();
});
