import { Clip, initSession } from '../index';
import { SiliconSynapse, SiliconBridge } from '@symphonyscript/kernel';

describe('Timing Methods', () => {
    let bridge: SiliconBridge;

    beforeEach(() => {
        const linker = SiliconSynapse.create({
            nodeCapacity: 1024,
            safeZoneTicks: 0
        });
        bridge = new SiliconBridge(linker);
        initSession(bridge);
    });

    describe('.wait() - Clip Start Delay', () => {
        test('.wait() sets clip start delay', () => {
            const clip = Clip.clip('WaitTest');
            clip.wait(480).note('C4');
            expect(clip).toBeDefined();
        });

        test('.wait() returns this for chaining', () => {
            const clip = Clip.clip('ChainTest');
            const result = clip.wait(240);
            expect(result).toBe(clip);
        });

        test('.wait() persists across multiple notes', () => {
            const clip = Clip.clip('PersistTest');
            clip.wait(480)
                .note('C4', 120)
                .note('D4', 120);
            // Both notes should be delayed by 480
            expect(clip.getCurrentTick()).toBe(240);
        });

        test('.wait() combines with .shift()', () => {
            const clip = Clip.clip('CombineTest');
            // wait(480) + shift(20) = note starts at 500
            clip.wait(480).shift(20).note('C4');
            expect(clip).toBeDefined();
        });
    });

    describe('.playbackOffset() - Latency Compensation', () => {
        test('.playbackOffset() accepts milliseconds', () => {
            const clip = Clip.clip('LatencyTest');
            clip.playbackOffset(10);
            expect(clip).toBeDefined();
        });

        test('.playbackOffset() returns this for chaining', () => {
            const clip = Clip.clip('ChainTest');
            const result = clip.playbackOffset(15);
            expect(result).toBe(clip);
        });

        test('.playbackOffset() writes to SAB', () => {
            const clip = Clip.clip('SABTest');
            clip.playbackOffset(20);

            // Verify value was written to SAB
            const bridge = (clip as any).bridge;
            expect(bridge.getPlaybackOffset()).toBe(20);
        });

        test('.playbackOffset() combines with other timing methods', () => {
            const clip = Clip.clip('CombineTest');
            clip.playbackOffset(10).wait(480).shift(20).note('C4');
            expect(clip).toBeDefined();
        });
    });
});
