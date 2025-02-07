import slack from '@slack/bolt'
import axios from 'axios'
import { BlockElementAction, StaticSelectAction } from '@slack/bolt'


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

    // Global middleware for logging Slack events
    bot.use(async ({ context, body, next }) => {
        console.log('---- Incoming Slack Event -----')
        console.log('Context:', context)
        console.log('Body:', JSON.stringify(body, null, 2))
        console.log('-------------------------------')
        await next()
    })

    bot.command('/obot-run-workflow', async ({ command, client, ack, respond }) => {
        console.warn('Command received:', command)
        await ack()

        try {
            console.warn('fetching daemon triggers')
            const response = await obot.get('/daemon-triggers?provider=slack-daemon-trigger-provider&withExecutions=true');
            const daemonTriggers = response.data.items;

            if (daemonTriggers.length === 0) {
                await respond({
                    text: 'No available workflows to run.'
                })
                return
            }


            console.warn('made it past daemon trigger fetch:', daemonTriggers)
            if (command.text !== '') {
                console.warn('Inside if statement')
                const selectedWorkflow = daemonTriggers.find((daemonTrigger: any) => 
                    daemonTrigger.workflow === command.text
                );
                if (selectedWorkflow) {
                    const invokeResponse = await obot.post(`/invoke/${selectedWorkflow.workflow}`);
                    await respond({
                        text: `Workflow ${selectedWorkflow.workflow} invoked successfully: ${JSON.stringify(invokeResponse.data)}`
                    });
                    return
                }
                await respond({
                    text: "Workflow ${command.text} not available."
                });
            }
            console.warn('Outside if statement')

            const options = daemonTriggers.map((daemonTrigger: any) => ({
                text: {
                    type: 'plain_text',
                    text: daemonTrigger.workflowExecutions?.find((exec: any) => exec?.workflow?.name)?.workflow?.name || daemonTrigger.workflow
                },
                value: daemonTrigger.workflow
            }))

            await respond({
                text: 'Select a workflow to run:',
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'Please select a workflow to run:'
                        },
                        accessory: {
                            type: 'static_select',
                            action_id: 'select_workflow',
                            focus_on_load: true,
                            placeholder: {
                                type: 'plain_text',
                                text: 'Select a workflow'
                            },
                            confirm: {
                                title: {
                                    type: 'plain_text',
                                    text: 'Confirm Workflow Run'
                                },
                                text: {
                                    type: 'plain_text',
                                    text: 'Are you sure you want to run this workflow?'
                                },
                                confirm: { type: 'plain_text', text: 'Run Workflow' },
                                deny: { type: 'plain_text', text: 'Cancel' },
                                style: 'primary'
                            },
                            options: options
                        }
                    }
                ]
            });
        } catch (error) {
            console.error('Error fetching daemon triggers:', error);
            await respond({
                text: 'Failed to fetch workflows. Please try again later.'
            });
        }
    });

    bot.action('select_workflow', async ({ action, client, ack, respond }) => {
        console.warn('Action received:', action)
        await ack()

        // Type guard to ensure action is of type StaticSelectAction
        if ('selected_option' in action) {
            const selectedWorkflow = (action as StaticSelectAction)?.selected_option?.value
            console.warn('selectedWorkflow:', selectedWorkflow)

            try {
                const invokeResponse = await obot.post(`/invoke/${selectedWorkflow}`);
                await respond({
                    response_type: 'in_channel',
                    text: `Workflow ${selectedWorkflow} invoked successfully: ${JSON.stringify(invokeResponse.data)}`
                })
            } catch (error) {
                console.error('Error invoking workflow:', error);
                await respond({
                    response_type: 'in_channel',
                    text: `Failed to invoke workflow ${selectedWorkflow}. Please try again later.`
                })
            }
        } else {
            await respond({
                text: 'Invalid action received.'
            })
        }
    })

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

    
    // Slack command handler for `/obot`
    // bot.command('/obot-list-workflows', async ({ command, client, ack, respond }) => {
    //     console.warn('/obot-list-workflows:', command)
    //     await ack()

    //     try {
    //         const response = await obot.get('/daemon-triggers?provider=slack-daemon-trigger-provider');
    //         const daemonTriggers = response.data.items;
    //         let triggerable = daemonTriggers.reduce((acc: any[], daemonTrigger: any) => {
    //             try {
    //                 const options = daemonTrigger.options ? JSON.parse(daemonTrigger.options) : {};
    //                 if (!options.channels && !options.users) {
    //                     acc.push(daemonTrigger.workflow);
    //                 } else if (options.channels?.includes(command.channel_name) || options.users?.includes(command.user_name)) {
    //                     acc.push(daemonTrigger.workflow);
    //                 }
    //             } catch (error) {
    //                 console.error('Error parsing options:', error);
    //             }
    //             return acc;
    //         }, []);

    //         // Deduplicate workflows by name
    //         triggerable = [...new Set(triggerable)];

    //         // Perform parallel get requests for /workflows/<name>
    //         let workflows = await Promise.all(triggerable.map(async (workflow: any) => {
    //             try {
    //                 const response = await obot.get(`/workflows/${workflow.name}`);
    //                 return response.data
    //             } catch (error) {
    //                 console.error(`Error fetching workflow details for ${workflow.name}:`, error)
    //                 return null
    //             }
    //         }))

    //         // Filter out any null responses
    //         workflows = workflows.filter((workflow: any) => workflow !== null);

    //         console.warn('-'.repeat(32));
    //         console.warn('Found workflows:\n', workflows);
    //         console.warn('-'.repeat(32));

    //         const blocks = workflows.map((workflow: any) => ({
    //             type: 'section',
    //             text: {
    //                 type: 'mrkdwn',
    //                 text: `*${workflow.name}*`
    //             }
    //         }))

    //         await respond({
    //             text: `Here are the workflows I have access to:`,
    //             blocks: [
    //                 {
    //                     type: 'section',
    //                     text: {
    //                         type: 'mrkdwn',
    //                         text: `*Workflows*`
    //                     }
    //                 },
    //                 ...blocks
    //             ]
    //         })
    //     } catch (error) {
    //         console.error('Error fetching workflows:', error);
    //         await respond({
    //             text: `Hello <@${command.user_id}>!
    //             I'm sorry, but I couldn't fetch the workflows. Please try again later.`,
    //         });
    //     }

    //     console.warn('Responded to command:', command.text)
    // })


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


    await bot.init()
    await bot.start()


    return bot
}
