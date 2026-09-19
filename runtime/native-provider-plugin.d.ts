import type { Context } from '@deepseek-ai/cordis';
export declare const name = "libre-webui-native-provider";
export declare const inject: string[];
export interface NativeProviderPluginConfig {
    socketPath: string;
    requestTimeoutMs?: number;
    maxConcurrentRequests?: number;
}
/** Start one local-only provider transport, owned and closed by this plugin fiber. */
export declare function apply(ctx: Context, options: NativeProviderPluginConfig): Promise<void>;
