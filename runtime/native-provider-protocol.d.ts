/** JSON-only protocol for one-call access to a native DSH model registry. */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
export declare const MAX_REQUEST_BYTES: number;
export declare const MAX_CHUNK_BYTES: number;
export declare const MAX_RESPONSE_BYTES: number;
export declare const NATIVE_PROVIDER_INSTANCE_HEADER = "x-native-provider-instance";
export interface NativeProviderModel {
    providerId: string;
    model: string;
    name: string;
    providerName: string;
    contextWindow?: number;
    defaultMaxTokens?: number;
    reasoning?: {
        efforts: Array<{
            id: string;
            name: string;
            description?: string;
        }>;
        defaultEffort?: string;
    };
}
export interface NativeProviderCatalog {
    instanceId: string;
    models: NativeProviderModel[];
}
export type NativeProviderRequest = Omit<GenerateOptions, 'signal' | 'sessionId'> & {
    instanceId?: string;
};
export declare class NativeProviderProtocolError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
export declare function parseNativeProviderRequest(value: unknown): NativeProviderRequest;
export declare function parseNativeProviderCatalog(value: unknown): NativeProviderCatalog;
export declare function parseNativeProviderChunk(value: unknown): StreamChunk;
