/** Types for env.mjs (plain JS so prepare.mjs runs with node alone). */
export declare const WEB_DIR: string;
export declare const API_DIR: string;
export declare const API_PORT: number;
export declare const WEB_PORT: number;
export declare const WEB_ORIGIN: string;
export declare const PASSWORD_ENV: string;
export declare function definedEnv(
  vars: Record<string, string | undefined>,
): Record<string, string>;
export declare function e2eEnv(): Record<string, string>;
