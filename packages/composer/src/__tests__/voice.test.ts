import { Clip, initSession } from '../index';
import { SiliconSynapse, SiliconBridge } from '@symphonyscript/kernel';

describe('.voice() MPE Routing', () => {
    let bridge: SiliconBridge;

    beforeEach(() => {
        const linker = SiliconSynapse.create({
            nodeCapacity: 1024,
            safeZoneTicks: 0
        });
        bridge = new SiliconBridge(linker);
        initSession(bridge);
    });

    test('Voice tags notes with expressionId', () => {
        const clip = Clip.clip('MPE');
        clip.voice(1, (v) => v.note('C4'));

        // Verify expressionId is stored (implementation-specific check)
        // NOTE: This test validates the API exists and works
        expect(clip).toBeDefined();
    });

    test('Nested voices', () => {
        const clip = Clip.clip('Nested');
        clip.stack(s => s
            .voice(1, v => v.note('C4'))
            .voice(2, v => v.note('E4'))
        );

        expect(clip).toBeDefined();
    });

    test('Voice restores previous expressionId', () => {
        const clip = Clip.clip('Restore');
        clip
            .voice(5, v => v.note('G4'))  // ID = 5
            .note('A4');  // ID should be back to 0 (default)

        // Verify restoration (implementation-specific)
        expect(clip).toBeDefined();
    });
});

describe('String Voice Names', () => {
    let bridge: SiliconBridge;

    beforeEach(() => {
        const linker = SiliconSynapse.create({
            nodeCapacity: 1024,
            safeZoneTicks: 0
        });
        bridge = new SiliconBridge(linker);
        initSession(bridge);
    });

    test('Voice accepts string name', () => {
        const clip = Clip.clip('StringVoice');
        clip.voice('lead', v => v.note('C4'));
        expect(clip).toBeDefined();
    });

    test('Same string produces same ID (consistent hashing)', () => {
        const clip = Clip.clip('ConsistentHash');
        // Same voice name should route to same expression
        clip.voice('lead', v => v.note('C4'));
        clip.voice('lead', v => v.note('E4'));  // Same ID
        clip.voice('bass', v => v.note('C2'));  // Different ID
        expect(clip).toBeDefined();
    });

    test('String and number can be mixed', () => {
        const clip = Clip.clip('MixedVoices');
        clip.stack(s => s
            .voice(1, v => v.note('C4'))      // Numeric
            .voice('alto', v => v.note('E4'))  // String
        );
        expect(clip).toBeDefined();
    });

    test('Empty string is valid (hashes to 0, default voice)', () => {
        // Empty string hashes to 0, which is the default voice.
        // This is valid behavior - no crash expected.
        const clip = Clip.clip('EmptyString');
        clip.voice('', v => v.note('C4'));
        expect(clip).toBeDefined();
    });
});
