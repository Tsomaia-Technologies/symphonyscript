import { SynapticCursor } from './SynapticCursor';

export abstract class SynapticMelodyBaseCursor extends SynapticCursor {
    // State
    protected _detune: number = 0;
    protected _timbre: number = 0;
    protected _pressure: number = 0;
    protected _glide: boolean = false;
    public isTie: boolean = false;
    public expressionId: number = 0;

    // Modifiers
    detune(val: number): this {
        this._detune = val;
        return this;
    }

    timbre(val: number): this {
        this._timbre = val;
        return this;
    }

    pressure(val: number): this {
        this._pressure = val;
        return this;
    }

    expression(id: number): this {
        this.expressionId = id;
        return this;
    }

    glide(enable: boolean = true): this {
        this._glide = enable;
        return this;
    }

    tie(enable: boolean = true): this {
        this.isTie = enable;
        return this;
    }
}
