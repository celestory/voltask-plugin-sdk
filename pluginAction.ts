import {JSONSchema, FromObjectSchema} from './schema.ts';

interface ActionParams<BlockSignature extends PluginActionBlockSignature> {
    values: FromObjectSchema<BlockSignature['params']['values']>;
    inputId: string;
}

interface ActionReturns<BlockSignature extends PluginActionBlockSignature> {
    values: FromObjectSchema<BlockSignature['returns']['values']>;
    outputId: string;
}

interface ActionDeriveBlockConfig<BlockConfig, RenderProps> {
    valid: boolean;
    blockConfig: BlockConfig;
    renderProps: RenderProps;
}

export interface PluginActionBlockSignature {
    inputs: string[];
    outputs: string[];
    //
    params: {order: string[]; values: Record<string, JSONSchema>};
    returns: {order: string[]; values: Record<string, JSONSchema>};
}

export interface PluginAction<
    BlockConfig,
    PluginConfig,
    BlockSignature extends PluginActionBlockSignature,
    //
    RenderProps = unknown,
    NeedPluginConfig extends boolean = boolean,
    PluginConfigIfNeeded = NeedPluginConfig extends true ? {pluginConfig: PluginConfig} : object,
    //
    SignedActionParams extends ActionParams<BlockSignature> = ActionParams<BlockSignature>,
    SignedActionReturns extends ActionReturns<BlockSignature> = ActionReturns<BlockSignature>,
> {
    manifest: {
        title: string;
        color: string;
        iconUrl: string;
        description: string;
        hasLifecycle: boolean;
        needsPluginConfig: NeedPluginConfig;
    };
    //
    deriveBlockConfig: (
        args: {
            form?: unknown;
            blockConfig?: BlockConfig;
        } & PluginConfigIfNeeded,
    ) => ActionDeriveBlockConfig<BlockConfig, RenderProps> | Promise<ActionDeriveBlockConfig<BlockConfig, RenderProps>>;
    renderBlockConfigSchema: (
        args: {
            renderProps: RenderProps;
            blockConfig: BlockConfig;
        } & PluginConfigIfNeeded,
    ) => JSONSchema | Promise<JSONSchema>;
    //
    renderBlockSignature: (
        args: {
            params?: Record<string, unknown>;
            blockConfig: BlockConfig;
        } & PluginConfigIfNeeded,
    ) => BlockSignature | Promise<BlockSignature>;
    //
    executeBlock: (
        //
        args: {
            params: SignedActionParams;
            blockConfig: BlockConfig;
            abortSignal?: AbortSignal;
        } & PluginConfigIfNeeded,
    ) =>
        | SignedActionReturns
        | Promise<SignedActionReturns>
        | Generator<SignedActionReturns, SignedActionReturns | undefined>
        | AsyncGenerator<SignedActionReturns, SignedActionReturns | undefined>;
}

export const createPluginAction =
    <BlockConfig, PluginConfig, BlockSignature extends PluginActionBlockSignature = PluginActionBlockSignature>() =>
    <RenderProps, NeedPluginConfig extends boolean>(action: PluginAction<BlockConfig, PluginConfig, BlockSignature, RenderProps, NeedPluginConfig>) =>
        action as PluginAction<unknown, unknown, PluginActionBlockSignature>;
