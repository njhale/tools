import slack from '@slack/bolt'
import axios from 'axios'
import { BlockElementAction, StaticSelectAction } from '@slack/bolt'
import { KnownBlock } from '@slack/types'
import { createParser, EventSourceMessage } from 'eventsource-parser'
import { skip } from 'node:test'

// TODO(njhale): Remove this once we have a better way to filter env vars
const envRegex = /^(OBOT_SERVER_URL|OBOT_API_TOKEN|OBOT_SLACK_DAEMON_TRIGGER_PROVIDER_BOT_TOKEN|OBOT_SLACK_DAEMON_TRIGGER_PROVIDER_APP_TOKEN|OBOT_SLACK_DAEMON_TRIGGER_PROVIDER_SIGNING_SECRET|PORT|TEST_DISABLE)/
const filteredEnv = Object.entries(process.env)
    .filter(([key]) => envRegex.test(key))
    .map(([key, value]) => `export ${key}='${value}'`)
    .join("\n")

const surround = (str: string, delim: string) => `\n${delim}\n${str}\n${delim}\n`
console.warn(surround(filteredEnv, '*'.repeat(64)))

// Function to start Slack App
export const startSlackBot = async (
    obotAPIToken: string,
    obotServerUrl: string,
    botToken: string,
    appToken: string,
    signingSecret: string
) => {
    const obot = axios.create({
        baseURL: obotServerUrl + '/api',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${obotAPIToken}`,
        }
    })

    // Initialize Slack App with environment variables
    const bot = new slack.App({
        token: botToken,
        appToken: appToken,
        signingSecret: signingSecret,
        deferInitialization: true,
        socketMode: true,
        logLevel: slack.LogLevel.INFO,
    })

    // TODO(njhale): Remove this after testing
    if (process.env.TEST_DISABLE === 'goose') {
        // Global middleware for logging Slack events
        bot.use(async ({ context, body, next }) => {
            console.log('---- Incoming Slack Event -----')
            console.log('Context:', context)
            console.log('Body:', JSON.stringify(body, null, 2))
            console.log('-------------------------------')
            await next()
        })

        bot.command('/obot-run-workflow', async ({ command, client, ack, respond }) => {
            console.warn('Command received:', command);
            await ack();

            try {
                console.warn('Fetching daemon triggers');
                const response = await obot.get('/daemon-triggers?provider=slack-daemon-trigger-provider&withExecutions=true');
                const daemonTriggers = response.data.items;

                if (daemonTriggers.length === 0) {
                    await respond({ text: 'No available workflows to run.' });
                    return;
                }
                const channelId = command.channel_id!

                if (command.text !== '') {
                    console.warn('Searching for workflow:', command.text);
                    const selectedWorkflow = daemonTriggers.find((daemonTrigger: any) =>
                        daemonTrigger.workflow === command.text
                    );

                    if (selectedWorkflow) {
                        await runWorkflow(selectedWorkflow.workflow, client, channelId, obotServerUrl);
                        return;
                    }

                    await respond({ text: `Workflow *${command.text}* not available.` });
                    return;
                }

                const options = daemonTriggers.map((daemonTrigger: any) => ({
                    text: {
                        type: 'plain_text',
                        text: `${daemonTrigger.workflowExecutions?.find((exec: any) => exec?.workflow?.name)?.workflow?.name || daemonTrigger.workflow} (${daemonTrigger.workflow})`,
                    },
                    value: daemonTrigger.workflow
                }));

                await respond({
                    text: 'Select a workflow to run:',
                    blocks: [
                        {
                            type: 'section',
                            text: { type: 'mrkdwn', text: 'Please select a workflow to run:' },
                            accessory: {
                                type: 'static_select',
                                action_id: 'select_obot_workflow',
                                placeholder: { type: 'plain_text', text: 'Select a workflow' },
                                options: options,
                                confirm: {
                                    style: 'primary',
                                    title: {
                                        type: 'plain_text',
                                        text: 'Confirm workflow run'
                                    },
                                    text: {
                                        type: 'plain_text',
                                        text: 'Are you sure you want to run this workflow?'
                                    },
                                    confirm: {
                                        type: 'plain_text',
                                        text: 'Run workflow'
                                    },
                                    deny: {
                                        type: 'plain_text',
                                        text: 'Cancel'
                                    }
                                }
                            }
                        }
                    ]
                });
            } catch (error) {
                console.error('Error fetching daemon triggers:', error);
                await respond({ text: 'Failed to fetch workflows. Please try again later.' });
            }
        });

        bot.action('select_obot_workflow', async ({ context, body, action, client, ack, respond }) => {
            console.warn('Action received:', action);
            await ack();

            if ('selected_option' in action) {
                const selectedWorkflow = (action as StaticSelectAction).selected_option?.value;
                console.warn('Selected workflow:', selectedWorkflow);

                const channel = body.channel?.id
                const user = context.userId

                try {
                    await runWorkflow(selectedWorkflow, client, channel!, obotServerUrl, user);
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Failed to invoke workflow. Please try again later.';
                    console.error('Error invoking workflow:', message);

                    const blocks: KnownBlock[] = [
                        {
                            type: 'section',
                            text: { type: 'mrkdwn', text: message }
                        }
                    ];

                    if (error instanceof Error && error.cause) {
                        blocks.push({
                            type: 'context',
                            elements: [
                                { type: 'mrkdwn', text: `> ${error.cause}` }
                            ]
                        });
                    }

                    await respond({ blocks });
                }
            } else {
                await respond({ text: 'Invalid action received.' });
            }
        });

        async function runWorkflow(
            workflowId: string,
            client: any,
            channel: string,
            obotServerUrl: string,
            user?: string
        ) {
            const messageContext: KnownBlock[] = user ? [
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `*Started by:* <@${user}>`
                        }
                    ]
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `*Workflow ID:* [${workflowId}](${obotServerUrl}/admin/workflows/${workflowId})`
                        }
                    ]
                },
            ] : [];

            try {
                const workflow = await obot.get(`/workflows/${workflowId}`)
                const workflowName = workflow.data.name


                const initialMessage = await client.chat.postMessage({
                    channel: channel,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `🔄 Running workflow *${workflowName}*...`
                            }
                        },
                        ...messageContext,
                    ]
                });
                const slackThreadId = initialMessage.ts!;

                console.warn(`Invoking workflow ${workflowId}`)
                const invokeResponse = await obot.post(`/invoke/${workflowId}`)
                console.warn(`Invoked workflow ${workflowId}: ${JSON.stringify(invokeResponse.data)}`)
                const systemThreadId = invokeResponse.data.threadID
                messageContext.push({
                    type: 'context',
                    elements: [
                        { type: 'mrkdwn', text: `*System Thread ID:* [${systemThreadId}](${obotServerUrl}/admin/threads/${systemThreadId})` }
                    ]
                })

                await client.chat.update({
                    channel: channel,
                    ts: slackThreadId,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `🔄 Workflow *${workflowName}* is in progress...`
                            }
                        },
                        ...messageContext,
                    ]
                });

                await streamWorkflowEvents(systemThreadId, slackThreadId, client, channel, obotServerUrl, messageContext);
            } catch (error) {
                console.error('Error invoking workflow:', error);
                throw new Error(`❌ Failed to invoke workflow *${workflowId}*. Please try again later.`, { cause: error });
            }
        }

        async function streamWorkflowEvents(
            workflowName: string,
            systemThreadId: string,
            slackThreadId: string,
            client: any,
            channel: string,
            messageContext: KnownBlock[]
        ) {
            const slackStepMessages: Record<string, string> = {}

            try {
                console.warn(`Making events request for thread ${systemThreadId}`)
                const response = await obot.get(`/threads/${systemThreadId}/events?follow=true&waitForThread=true`,
                    {
                        headers: {
                            'Authorization': `Bearer ${obotAPIToken}`,
                            'Accept': 'text/event-stream',
                        },
                        responseType: 'stream',
                    }
                )
                console.warn('Event stream get returned, streaming events...')

                const parser = createParser({
                    onEvent: async (event: EventSourceMessage) => {
                        try {
                            console.warn(`Event received: ${event.data}`)
                            const json = JSON.parse(event.data);

                            if (json.step) {
                                const stepId = json.step.id;
                                const stepText = `⏳ Step *${json.step.step}* in progress...`;
                                const outputText = json.content
                                    ? `\n\n📝 Output:\n\`\`\`${json.content}\`\`\``
                                    : '';

                                if (!slackStepMessages[stepId]) {
                                    // First time seeing this step: Post a new message and store its ts
                                    const message = await client.chat.postMessage({
                                        channel,
                                        thread_ts: slackThreadId,
                                        text: `${stepText}${outputText}`,
                                    });
                                    slackStepMessages[stepId] = message.ts;
                                } else {
                                    // Step already exists, update its message
                                    const finalStepText = json.success
                                        ? `✅ Step *${json.step.step}* executed successfully.`
                                        : `❌ Step *${json.step.step}* failed.`;

                                    await client.chat.update({
                                        channel,
                                        ts: slackStepMessages[stepId],
                                        text: `${finalStepText}${outputText}`,
                                    });
                                }
                            }
                        } catch (parseError) {
                            console.error('Error parsing event data:', parseError);
                        }
                    },
                    onError: (error) => {
                        console.error('Error event received:', error);
                    },
                });

                for await (const chunk of response.data) {
                    parser.feed(chunk.toString());
                }

                await client.chat.update({
                    channel: channel,
                    ts: slackThreadId,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `🎉 Workflow *${wor}* ran successfully!`
                            }
                        },
                        ...messageContext
                    ]
                });
            } catch (error) {
                console.error('Error establishing event stream:', error);
                await client.chat.update({
                    channel: slackThreadId,
                    ts: slackThreadId,
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: '❌ Error streaming workflow events.'
                            }
                        },
                        ...messageContext
                    ]
                });
            }
        }

        bot.command('/obot-list-workflows', async ({ command, client, ack, respond }) => {
            console.warn('/obot-list-workflows:', command)
            await ack()

            try {
                const response = await obot.get('/daemon-triggers?provider=slack-daemon-trigger-provider&withExecutions=true');
                const daemonTriggers = response.data.items;

                const blocks = daemonTriggers.flatMap((daemonTrigger: any) => {
                    const workflowExecutions = daemonTrigger.workflowExecutions || [];
                    const latestExecution = workflowExecutions[workflowExecutions.length - 1] || {};
                    const executionCount = workflowExecutions.length;
                    const latestState = latestExecution.state || 'No executions';
                    const latestError = latestExecution.error || 'No error';
                    const workflowName = latestExecution.workflow?.name || daemonTrigger.workflow.name;

                    return [
                        { type: 'divider' },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `*${workflowName}*\n*State:* ${latestState}\n*Error:* ${latestError}\n*Runs:* ${executionCount}`
                            }
                        },
                        { type: 'divider' }
                    ];
                });

                if (blocks.length === 0) {
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'No workflows found.'
                        }
                    });
                }

                await respond({
                    text: `The available workflows are listed below`,
                    blocks: [
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: 'Workflows'
                            }
                        },
                        ...blocks
                    ]
                });
            } catch (error) {
                console.error('Error fetching workflows:', error);
                await respond({
                    text: `Hello <@${command.user_id}>!
                I'm sorry, but I couldn't fetch the workflows. Please try again later.`,
                });
            }

            console.warn('Responded to command:', command.text)
        })

        bot.command('/obot-get-workflow', async ({ command, ack, respond }) => {
            console.warn('Command received:', command)
            await ack()
            await respond({
                text: `Hello <@${command.user_id}>! You ran the command: ${command.text}`,
            })
            console.warn('Responded to command:', command.text)
        })

        // Message event handler for "hello"
        bot.message(async ({ message, say }) => {
            console.log(`Received message event: ${JSON.stringify(message)}`)
            await say({ text: 'Hey there!' })
        })
    }


    await bot.init()
    await bot.start()


    return bot
}
