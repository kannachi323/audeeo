import {expect,it,vi} from 'vitest';
import {clearPersonalKeys} from '../src/lib/billingMigration';
it('clears retired personal key storage without touching account credentials',()=>{
 const storage={removeItem:vi.fn()};clearPersonalKeys(storage);
 expect(storage.removeItem.mock.calls.flat()).toEqual(['audeeo.openai-key','audeeo.soniox-key','audeeo.provider-keys']);
});
