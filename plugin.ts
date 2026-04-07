import {JSONSchema} from './schema.ts';
import type {PluginAction, PluginActionBlockSignature} from './pluginAction.ts';
import type {PluginTrigger, PluginTriggerBlockSignature} from './pluginTrigger.ts';

interface PluginDeriveConfig<Config, RenderProps> {
    config: Config;
    renderProps: RenderProps;
}

export interface Plugin<Config, RenderProps = unknown> {
    manifest: {
        uid: string;
        title: string;
        color: string;
        iconUrl: string;
        description: string;
    };
    translations: {
        fr: Record<string, unknown>;
        [lang: string]: Record<string, unknown>;
    };
    //
    deriveConfig: (
        //
        args: {
            form?: unknown;
            config?: Config;
        },
    ) => PluginDeriveConfig<Config, RenderProps> | Promise<PluginDeriveConfig<Config, RenderProps>>;
    renderConfigSchema: (
        //
        args: {
            config: Config;
            renderProps: RenderProps;
        },
    ) => JSONSchema | Promise<JSONSchema>;
    cleanupConfig?: (config: Config) => void | Promise<void>;
    //
    actions: Record<string, PluginAction<unknown, Config, PluginActionBlockSignature, unknown>>;
    triggers: Record<string, PluginTrigger<unknown, unknown, Config, PluginTriggerBlockSignature, unknown>>;
}

export const createPlugin =
    <Config>() =>
    <RenderProps>(plugin: Plugin<Config, RenderProps>) =>
        plugin as Plugin<unknown, unknown>;
