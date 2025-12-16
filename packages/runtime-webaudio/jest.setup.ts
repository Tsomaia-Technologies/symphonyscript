import { AudioContext, AudioNode } from 'standardized-audio-context-mock';

(global as any).AudioContext = AudioContext;
(global as any).AudioNode = AudioNode;
