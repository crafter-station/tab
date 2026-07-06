export type ServiceFailure<Code extends string> = {
  code: Code;
  message: string;
};

export type EffectService<Input, Output, Failure extends ServiceFailure<string>> = {
  readonly name: string;
  readonly execute: (input: Input) => Promise<Output> | Output;
  readonly failures: readonly Failure["code"][];
};

export function defineEffectService<Input, Output, Failure extends ServiceFailure<string>>(
  service: EffectService<Input, Output, Failure>,
): EffectService<Input, Output, Failure> {
  return service;
}
