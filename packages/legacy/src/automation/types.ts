/** Built-in automation targets */
export type BuiltinAutomationTarget =
  | 'volume'
  | 'pan'
  | 'filter_cutoff'
  | 'filter_resonance'
  | 'reverb_send'
  | 'delay_send'
  | 'chorus_depth'
  | 'pitch_bend'
  | 'expression'  // CC11
  | 'modulation'  // CC1

/** Branded type for custom targets */
declare const CustomTargetBrand: unique symbol
export type CustomAutomationTarget = string & { readonly [CustomTargetBrand]: never }

/** All automation targets */
export type AutomationTarget = BuiltinAutomationTarget | CustomAutomationTarget

/** Create a custom automation target (escape hatch) */
export function customTarget(name: string): CustomAutomationTarget {
  if (!name || name.length > 64) {
    throw new Error(`Custom target name must be 1-64 characters`)
  }
  return name as CustomAutomationTarget
}

/** Type guard for builtin targets */
export function isBuiltinTarget(target: AutomationTarget): target is BuiltinAutomationTarget {
  const builtins: string[] = [
    'volume', 'pan', 'filter_cutoff', 'filter_resonance',
    'reverb_send', 'delay_send', 'chorus_depth', 'pitch_bend',
    'expression', 'modulation'
  ]
  return builtins.includes(target as string)
}

export interface AutomationPoint {
  beat: number;
  value: number;
  curve?: 'linear' | 'exponential' | 'smooth';
}

export interface AutomationLane {
  target: AutomationTarget;
  points: AutomationPoint[];
}

export interface AutomationOp {
  kind: 'automation';
  target: AutomationTarget;
  value: number;
  rampBeats?: number;
  curve?: 'linear' | 'exponential' | 'smooth';
  _source?: import('../clip/types').SourceLocation;
}
