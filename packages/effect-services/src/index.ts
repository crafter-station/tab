import { Effect } from "effect";

export type ServiceFailure<Code extends string> = {
  readonly code: Code;
  readonly message: string;
};

export type EffectService<Input, Output, Failure extends ServiceFailure<string>> = {
  readonly name: string;
  readonly execute: (input: Input) => Effect.Effect<Output, Failure>;
};

export const runEffectService = <Input, Output, Failure extends ServiceFailure<string>>(
  service: EffectService<Input, Output, Failure>,
  input: Input,
): Promise<Output> => Effect.runPromise(service.execute(input));
