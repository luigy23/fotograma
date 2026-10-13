declare module '@lottie-animation-community/lottie-specs' {
  export interface LottieValidatorError {
    type: 'error' | 'warning';
    warning?: 'type' | 'property';
    message: string;
    path: string;
    name: string;
    docs: string;
  }
  export class LottieValidator {
    constructor(AjvClass: unknown, schema: object, config?: { name_paths?: boolean; docs_url?: string });
    validate(data: object, showWarnings?: boolean): LottieValidatorError[];
  }
}

declare module 'lottie-web/build/player/lottie_light' {
  import lottie from 'lottie-web';
  export default lottie;
}
