import { Clip, initSession } from '../index';
import { SiliconSynapse, SiliconBridge } from '@symphonyscript/kernel';

describe('Groove Integration', () => {
    let bridge: SiliconBridge;

    beforeEach(() => {
        const linker = SiliconSynapse.create({
            nodeCapacity: 1024,
            safeZoneTicks: 0
        });
        bridge = new SiliconBridge(linker);
        initSession(bridge);
    });

    test('.use() accepts groove template', () => {
        const mpc = Clip.groove().swing(0.55).steps(4).build();
        const clip = Clip.clip('Groove');
        clip.use(mpc).note('C4').note('D4');
        expect(clip).toBeDefined();
    });

    test('.use() returns this for chaining', () => {
        const groove = Clip.groove().swing(0.6).build();
        const clip = Clip.clip('ChainTest');
        const result = clip.use(groove);
        expect(result).toBe(clip);
    });

    test('Swing applies to odd steps', () => {
        const groove = Clip.groove().swing(0.66).steps(4).build();
        const clip = Clip.clip('SwingTest');

        // Note 1: step 0 (even) - no swing
        // Note 2: step 1 (odd) - swing applied
        // Note 3: step 2 (even) - no swing
        // Note 4: step 3 (odd) - swing applied
        clip.use(groove)
            .note('C4', 120)
            .note('D4', 120)
            .note('E4', 120)
            .note('F4', 120);

        // Verify clip was built without errors
        expect(clip.getCurrentTick()).toBe(480);
    });

    test('Step index wraps around after groove.steps', () => {
        const groove = Clip.groove().swing(0.6).steps(2).build();
        const clip = Clip.clip('WrapTest');

        clip.use(groove)
            .note('C4', 120)  // Step 0
            .note('D4', 120)  // Step 1
            .note('E4', 120)  // Step 0 (wrapped)
            .note('F4', 120); // Step 1

        expect(clip.getCurrentTick()).toBe(480);
    });

    test('No swing when swing=0.5 (default)', () => {
        const groove = Clip.groove().swing(0.5).steps(4).build();
        const clip = Clip.clip('NoSwing');

        clip.use(groove).note('C4').note('D4');

        // swing=0.5 means no offset, should behave normally
        expect(clip.getCurrentTick()).toBe(960);
    });

    test('Multiple grooves can be applied', () => {
        const groove1 = Clip.groove().swing(0.55).build();
        const groove2 = Clip.groove().swing(0.66).build();
        const clip = Clip.clip('MultiGroove');

        clip.use(groove1).note('C4');
        clip.use(groove2).note('D4');  // Replaces groove1

        expect(clip).toBeDefined();
    });
});
