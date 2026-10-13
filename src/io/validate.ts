import Ajv2020 from 'ajv/dist/2020';
import { LottieValidator } from '@lottie-animation-community/lottie-specs';
import schema from '@lottie-animation-community/lottie-specs/src/data/lottie.schema.json';

// Valida contra el esquema oficial de Lottie 1.0 (Lottie Animation Community).
// Los avisos de propiedades desconocidas no cuentan: Bodymovin añade campos
// como `v`, `ddd` o `st` que el esquema no recoge pero los reproductores usan.

export interface ValidationIssue {
  message: string;
  path: string;
}

let validator: LottieValidator | null = null;

export function validateLottie(json: unknown): ValidationIssue[] {
  if (!validator) validator = new LottieValidator(Ajv2020, JSON.parse(JSON.stringify(schema)));
  return validator
    .validate(json as object, false)
    .filter((e) => e.type === 'error')
    .map((e) => ({ message: e.message, path: e.path }));
}
