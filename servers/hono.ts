import type {Hono} from 'https://deno.land/x/hono@v3.7.0-rc.1/mod.ts';

import {initDatabase} from '../database/database.ts';
import {forgetTrigger} from '../database/database.ts';
import {rememberTrigger} from '../database/database.ts';
import {getSavedTriggers} from '../database/database.ts';
import type {Plugin} from '../plugin.ts';
import type {DatabaseDriver} from '../database/database.ts';

export const createServer = (HonoConstructor: typeof Hono, driver: DatabaseDriver, plugin: Plugin<unknown, unknown>) => {
    // TODO: Better error handling
    driver.init();
    const app = new HonoConstructor();
    initDatabase(driver);

    for (const triggerName of Object.keys(plugin.triggers)) {
        const trigger = plugin.triggers[triggerName]!;
        if (trigger.manifest.rememberTrigger) {
            for (const {plugin: _1, trigger: _2, ...args} of getSavedTriggers(plugin.manifest.uid, triggerName)) {
                try {
                    // deno-lint-ignore no-explicit-any
                    trigger.watchBlock(args as any);
                } catch (err) {
                    console.error(`rememberedTrigger ${triggerName} failed with error`, err);
                }
            }
        }
    }

    app.get('/', async ctx => {
        const {config: pluginConfig} = await plugin.deriveConfig({});
        return ctx.json({
            manifest: plugin.manifest,
            //
            actions: await Object.entries(plugin.actions).reduce(
                async (actions, [name, action]) => ({
                    ...(await actions),
                    [name]: {
                        manifest: action.manifest,
                        signature: await action.renderBlockSignature({
                            blockConfig: (
                                await action.deriveBlockConfig({
                                    pluginConfig,
                                })
                            ).blockConfig,
                            pluginConfig,
                        }),
                    },
                }),
                Promise.resolve({}),
            ),
            triggers: await Object.entries(plugin.triggers).reduce(
                async (triggers, [name, trigger]) => ({
                    ...(await triggers),
                    [name]: {
                        manifest: trigger.manifest,
                        signature: await trigger.renderBlockSignature({
                            blockConfig: (await trigger.deriveBlockConfig({webhookUrl: '', pluginConfig})).blockConfig,
                        }),
                    },
                }),
                Promise.resolve({}),
            ),
        });
    });

    app.post(`/configSchema`, async ctx => {
        const {form, config} = await ctx.req.json();
        const {renderProps, config: derivedConfig} = await plugin.deriveConfig({form, config});

        return ctx.json({
            config: derivedConfig,
            configSchema: await plugin.renderConfigSchema({renderProps: renderProps, config: derivedConfig}),
        });
    });

    app.delete(`/cleanup`, async ctx => {
        const {config} = await ctx.req.json();
        if (plugin.cleanupConfig) {
            await plugin.cleanupConfig(config);
        }
        return ctx.json({});
    });

    for (const [actionName, action] of Object.entries(plugin.actions)) {
        app.post(`/actions/${actionName}/bestConfig`, async ctx => {
            const {pluginConfigs} = await ctx.req.json();
            const pluginConfigUids = Object.keys(pluginConfigs);

            for (const pluginConfigUid of pluginConfigUids) {
                const {valid} = await action.deriveBlockConfig({pluginConfig: pluginConfigs[pluginConfigUid]!});
                if (valid) {
                    return ctx.json({bestConfigUid: pluginConfigUid});
                }
            }
            return ctx.json({
                bestConfigUid: pluginConfigUids[0],
            });
        });
        app.post(`/actions/${actionName}/blockSchema`, async ctx => {
            const {form, blockConfig, pluginConfig} = await ctx.req.json();
            const {valid, renderProps, blockConfig: derivedBlockConfig} = await action.deriveBlockConfig({form, blockConfig, pluginConfig});

            return ctx.json({
                valid,
                blockConfig: derivedBlockConfig,
                blockConfigSchema: await action.renderBlockConfigSchema({renderProps: renderProps, blockConfig: derivedBlockConfig, pluginConfig}),
                needsPluginConfig: action.manifest.needsPluginConfig,
            });
        });
        app.post(`/actions/${actionName}/blockSignature`, async ctx => {
            const {params, blockConfig, pluginConfig} = await ctx.req.json();

            return ctx.json(await action.renderBlockSignature({params, blockConfig, pluginConfig}));
        });

        app.post(`/actions/${actionName}/executeBlock`, async ctx => {
            try {
                const {params, blockConfig, pluginConfig} = await ctx.req.json();
                switch (action.executeBlock.constructor.name) {
                    case 'Function': {
                        return ctx.json({done: true, value: action.executeBlock({params, blockConfig, pluginConfig})});
                    }
                    case 'AsyncFunction': {
                        return ctx.json({done: true, value: await action.executeBlock({params, blockConfig, pluginConfig})});
                    }
                    case 'GeneratorFunction':
                    case 'AsyncGeneratorFunction': {
                        const generator = await action.executeBlock({params, blockConfig, pluginConfig});
                        return ctx.streamText(async stream => {
                            try {
                                while (true) {
                                    const {done, value} = await (generator as AsyncGenerator).next();

                                    await stream.writeln(JSON.stringify({done, value}));
                                    if (done) {
                                        return;
                                    }
                                }
                            } catch (e) {
                                await stream.writeln(JSON.stringify({done: false, error: {statusCode: 500, message: e.toString()}}));
                                console.error(`/actions/${actionName}/executeBlock`, e);
                            }
                        });
                    }
                    default: {
                        throw new Error(`Cannot run executeBlock: ${action.executeBlock.constructor.name}`);
                    }
                }
            } catch (err) {
                return ctx.json({error: err.toString()}, 400);
            }
        });
    }

    for (const [triggerName, trigger] of Object.entries(plugin.triggers)) {
        app.post(`/triggers/${triggerName}/bestConfig`, async ctx => {
            const {pluginConfigs} = await ctx.req.json();
            const pluginConfigUids = Object.keys(pluginConfigs);

            for (const pluginConfigUid of pluginConfigUids) {
                const {valid} = await trigger.deriveBlockConfig({
                    webhookUrl: 'BEST_CONFIG',
                    pluginConfig: pluginConfigs[pluginConfigUid]!,
                });
                if (valid) {
                    return ctx.json({bestConfigUid: pluginConfigUid});
                }
            }
            return ctx.json({
                bestConfigUid: pluginConfigUids[0],
            });
        });
        app.post(`/triggers/${triggerName}/blockSchema`, async ctx => {
            const {form, webhookUrl, blockConfig, pluginConfig} = await ctx.req.json();
            const {valid, renderProps, blockConfig: derivedBlockConfig} = await trigger.deriveBlockConfig({form, webhookUrl, blockConfig, pluginConfig});

            return ctx.json({
                valid,
                blockConfig: derivedBlockConfig,
                blockConfigSchema: await trigger.renderBlockConfigSchema({renderProps: renderProps, blockConfig: derivedBlockConfig, pluginConfig}),
                needsPluginConfig: trigger.manifest.needsPluginConfig,
            });
        });
        app.post(`/triggers/${triggerName}/blockSignature`, async ctx => {
            const {params, blockConfig, pluginConfig} = await ctx.req.json();

            return ctx.json(await trigger.renderBlockSignature({params, blockConfig, pluginConfig}));
        });
        app.post(`/triggers/${triggerName}/watchBlock`, async ctx => {
            const {webhookUrl, blockConfig, cleanupData, pluginConfig} = await ctx.req.json();
            const nextCleanupData = await trigger.watchBlock({webhookUrl, blockConfig, cleanupData, pluginConfig});

            if (trigger.manifest.rememberTrigger) {
                rememberTrigger({blockConfig, pluginConfig, trigger: triggerName, plugin: plugin.manifest.uid, webhookUrl, cleanupData: nextCleanupData});
            }

            return ctx.json(nextCleanupData);
        });
        app.delete(`/triggers/${triggerName}/cleanupBlock`, async ctx => {
            const {webhookUrl, blockConfig, pluginConfig, cleanupData} = await ctx.req.json();

            if (trigger.manifest.rememberTrigger) {
                forgetTrigger({plugin: plugin.manifest.uid, trigger: triggerName, webhookUrl});
            }

            return ctx.json(await trigger.cleanupBlock({blockConfig, pluginConfig, cleanupData}));
        });
        app.all(`/triggers/${triggerName}/executeBlock`, async ctx => {
            const blockConfig = JSON.parse(ctx.req.header('X-Voltask-BlockConfig') ?? 'null') ?? undefined;
            const pluginConfig = JSON.parse(ctx.req.header('X-Voltask-PluginConfig') ?? 'null') ?? undefined;
            switch (trigger.executeBlock.constructor.name) {
                case 'Function': {
                    return ctx.json({done: true, value: trigger.executeBlock({request: ctx.req.raw, blockConfig, pluginConfig})});
                }
                case 'AsyncFunction': {
                    return ctx.json({done: true, value: await trigger.executeBlock({request: ctx.req.raw, blockConfig, pluginConfig})});
                }
                case 'GeneratorFunction':
                case 'AsyncGeneratorFunction': {
                    const generator = await trigger.executeBlock({request: ctx.req.raw, blockConfig, pluginConfig});
                    return ctx.streamText(async stream => {
                        try {
                            while (true) {
                                const {done, value} = await (generator as AsyncGenerator).next();

                                await stream.writeln(JSON.stringify({done, value}));
                                if (done) {
                                    return;
                                }
                            }
                        } catch (e) {
                            console.error(`/triggers/${triggerName}/executeBlock`, e);
                            await stream.writeln(JSON.stringify({done: false, error: {statusCode: 500, message: e.toString()}}));
                        }
                    });
                }
                default: {
                    throw new Error(`Cannot run executeBlock: ${trigger.executeBlock.constructor.name}`);
                }
            }
        });
    }

    app.onError((error, ctx) => {
        console.error(`hono error:`, error);
        return ctx.json({error: error.message}, 500);
    });

    return app;
};

export const createServers = (HonoConstructor: typeof Hono, driver: DatabaseDriver, plugins: Record<string, Plugin<unknown, unknown>>) => {
    const app = new HonoConstructor();

    for (const [name, plugin] of Object.entries(plugins)) {
        app.route(`/${name}`, createServer(HonoConstructor, driver, plugin));
    }
    return app;
};
