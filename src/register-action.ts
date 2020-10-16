import { Subscription } from 'rxjs'
import * as sourcegraph from 'sourcegraph'
import { evaluateAndCreateCampaignSpec } from '@sourcegraph/campaigns-client'
import slugify from 'slugify'
import { getCurrentUser } from './util'

// TODO(sqs) SECURITY(sqs): sanitize for real
const escapedMarkdownCode = (text: string): string => '`' + text.replace(/`/g, '\\`') + '`'

// TODO: make this file filter configurable.
// The filter is applied on all files of each matching repo (confirm - is that correct?)
const fileFilter = (path: string): boolean => path.endsWith('.yaml') || path.endsWith('.yml') || path.endsWith('.md')

export const registerFindReplaceAction = (): Subscription => {
    const subscription = new Subscription()
    subscription.add(
        sourcegraph.commands.registerCommand('start-find-replace', async () => {
            // To create campaigns, a namespace is used, which can be the current user's username.
            const currentUser = await getCurrentUser()
            const namespaceName = currentUser?.username
            console.log('currentUser', currentUser)

            const match = await sourcegraph.app.activeWindow!.showInputBox({
                prompt: 'Find all matches of:',
            })
            if (!match) {
                return
            }
            const replacement = await sourcegraph.app.activeWindow!.showInputBox({
                prompt: 'Replace with:',
            })
            if (replacement === undefined) {
                return
            }

            const name = `replace-${slugify(match)}-with-${slugify(replacement)}`
            const description = `Replace ${escapedMarkdownCode(match)} with ${escapedMarkdownCode(replacement)}`

            let percentage = 0
            const { applyURL, diffStat } = await sourcegraph.app.activeWindow!.withProgress(
                { title: '**Find-replace**' },
                async reporter =>
                    evaluateAndCreateCampaignSpec(namespaceName, {
                        name,
                        on: [
                            {
                                repositoriesMatchingQuery: match,
                            },
                        ],
                        description,
                        steps: [
                            {
                                fileFilter,
                                editFile: (path, text) => {
                                    if (!text.includes(match)) {
                                        return null
                                    }
                                    try {
                                        console.log('editFile running on', path)
                                    } catch (error) {
                                        console.error('Caught', error)
                                    }

                                    percentage += (100 - percentage) / 100
                                    reporter.next({ message: `Computing changes in ${path}`, percentage })
                                    return text.split(match).join(replacement)
                                },
                            },
                        ],
                        changesetTemplate: {
                            title: description,
                            branch: `campaign/${name}`,
                            commit: {
                                message: description,
                                author: {
                                    name: currentUser.username,
                                    email: currentUser.email,
                                },
                            },
                            published: false,
                        },
                    })
            )
            await sourcegraph.app.activeWindow!.showNotification(
                `[**Find-replace changes**](${applyURL}) are ready to preview and apply.<br/><br/><small>${diffStat.added} additions, ${diffStat.changed} changes, ${diffStat.deleted} deletions</small>`,
                sourcegraph.NotificationType.Success
            )

            // const relativeURL = new URL(applyURL)
            // await sourcegraph.commands.executeCommand('open', `${relativeURL.pathname}${relativeURL.search}`)
        })
    )
    return subscription
}
