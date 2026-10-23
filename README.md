# n8n-nodes-zellia

n8n community nodes for [Zellia](https://zellia.io). Use them to send messages, manage conversations, contacts and deals, and start workflows from Zellia events. You set parameters in the node. You do not write HTTP requests or JSON bodies.

The package has three nodes:

- **Zellia**: actions on messages, conversations, contacts, deals and pipelines. It can also be used as a tool by the n8n AI Agent.
- **Zellia Trigger**: starts a workflow when something happens in Zellia.
- **Zellia Captain Tool Trigger**: receives the calls of Captain custom tools, with the conversation and contact already read.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#zellia-trigger) · [Notes](#notes) · [Development](#development)

## Requirements

Self-hosted n8n. The package is not available on n8n Cloud, because the URL download check uses the Node `dns` module.

## Installation

1. In n8n, open **Settings → Community Nodes**.
2. Select **Install** and enter `n8n-nodes-zellia`.
3. Accept the risk notice and select **Install**.

For queue mode or Docker without the UI, follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create a **Zellia API** credential:

| Field | Value |
|---|---|
| Base URL | `https://app.zellia.io`, or your own instance |
| Account ID | The number after `/app/accounts/` in the Zellia URL |
| Access Token | An agent token (**Profile settings → Access token**), or an agent bot token (**Settings → Bots**) |
| Default Country Code | Optional, such as `57`. Added to phone numbers written without a country code. Empty: only the `+` is added |

n8n tests the credential with the inbox list. That endpoint accepts both token types.

### Agent token or bot token?

Zellia allows a bot token only on some endpoints. Messages, actions sent by the bot and deal moves show the bot name in Zellia, so a bot token is the right choice for bots. Use an agent token for the operations in this table:

| Needs an agent token | Works with a bot token |
|---|---|
| Contact: all operations | Message: Send, Send Attachment |
| Conversation: Get Many, Get Messages, Start Outbound | Conversation: Get, Get Status, Create, Set Status, Assign, Hand Off, Labels, Custom Attributes, Priority |
| Deal: Create, Link Conversation, **Register Sale** | Deal: Get, Get Many, Find for Contact or Conversation, Move to Stage, Mark as Won, Mark as Lost (without a reason), Get History, Get Conversations |
| Deal: Update of custom attributes or agent, Mark as Lost with a reason | Deal: Update (amount and currency only) |
| Deal: Delete (administrator) | Pipeline: all operations, and the inbox, pipeline and stage dropdowns |
| Lists of labels, agents, teams and custom attributes in the dropdowns | |
| Zellia Trigger with **Account Webhook** (administrator) | |

When Zellia silently ignores a change that the token is not allowed to make (deal attributes or agent with a bot token), the node stops with a clear error instead of reporting success.

**Personal tokens:** a token belongs to a person. Their actions appear under their name, and the flows break when the person leaves or the token changes. For automations, create a dedicated agent user (for example "Automations") or use an agent bot, and keep personal tokens out of production flows.

If a token is not allowed, the node stops with the message *This operation needs an agent token*.

## Operations

### Message

- **Send**: text, private note, buttons, cards, or an approved WhatsApp template with numbered or named variables, a header (text variables or an image, video or document) and button values (URL suffix or coupon code, by button position). Options: quote a message, or send as a specific agent bot.
- **Send Attachment**: send a file with an optional caption. The file can come from a binary field or from a public **URL**. Zellia does not accept URLs, so the node downloads the file (up to 40 MB) and uploads it. With a URL, you do not need an HTTP Request node, and AI agents can send files when they use the node as a tool. For safety, the node downloads only from public addresses. It refuses localhost, internal names and private IPs. It checks the DNS addresses when it connects and connects only to a checked address, on every redirect hop. A download stops at 40 MB or after 30 seconds. The download uses its own HTTP client, so the instance proxy settings do not apply to it.

### Conversation

- **Get**, **Get Status** (status, whether a bot, an agent or nobody handles it, agent, team, priority and labels), **Get Labels**, **Get Custom Attributes**, **Get Messages**, **Get Many** (filters: status, assignee, inbox, team, labels, text)
- **Hand Off**: in one step, sends a message to the contact, leaves a private note, adds, removes or replaces labels, assigns an agent or a team, and changes the status. Every field is optional. With **Continue If a Step Fails**, the other steps still run and the failed ones are listed in `errors`.
- **Create** for an existing contact
- **Start Outbound**: finds the contact by phone number, or creates it. Then it reuses an open conversation in the inbox, or creates one, and sends the first message (text or template). One node replaces the search → create → open → send chain.
- **Set Status** (open, pending, resolved, snoozed), **Set Priority**
- **Assign** to an agent, an agent bot or a team, or remove the agent or team
- **Add Labels** and **Remove Labels** keep the other labels. Zellia replaces the full list on every save, so the node reads the list first. **Replace Labels** sets the exact list.
- **Set Custom Attributes**: merges by default. Turn on **Replace All Attributes** to delete the attributes you do not list.

### Contact

- **Create or Update**: finds the contact by phone, email or identifier, with an exact match, then updates or creates it. The output field `upsertResult` is `found`, `updated` or `created`.
- **Create**, **Get**, **Update**, **Search**, **Get Conversations**

Phone numbers are normalized to E.164: `+57 300-123 4567` becomes `+573001234567`.

### Deal

- **Find for Contact or Conversation**: finds deals from a conversation ID or a contact ID. Optional filters: pipeline, status, and only deals linked to the conversation.
- **Mark as Won** and **Mark as Lost** can find the deal by **Deal ID** or by **Conversation ID**. With a conversation, the node uses the open deal of the contact in the pipeline. The `result` field says `won`, `lost`, `already_won`, `already_lost` or `no_deal`, so a Switch node can branch on it.
- **Mark as Won**: sets the amount, if given, then moves the deal to the won stage of its pipeline. It works with bot tokens. If the deal is already won, nothing changes and `amountDiffers` says whether the amount you sent is different.
- **Register Sale**: Zellia's own sale registration (agent token). It sets the amount and wins the deal in one locked step. The same amount again is a no-op, and a different amount on a won deal is refused. Both Mark as Won and Register Sale trigger the same Purchase report in Zellia.
- **Mark as Lost** can save a reason in a deal attribute (agent token).
- **Move to Stage** returns `result`: `moved`, `already_in_stage`, or `skipped_backward` when **Only Move Forward** is on and the stage is earlier on the board.
- **Update** merges custom attributes with the current ones. Zellia does the merge in one locked step, so two flows that write different attributes at the same time do not overwrite each other. Turn on **Replace All Attributes** to delete the ones you do not list.
- **Wait for the Deal**: Zellia opens the deal of a new conversation a moment after the conversation is created. The conversation lookup and Find for Contact can wait a few seconds for it. Create also returns the deal that Zellia opened in the meantime instead of failing. Zellia requires an amount above 0. If you leave the amount at 0, the node keeps the current amount. If the deal is already won, nothing changes and the output has `alreadyInStage: true`.
- **Mark as Lost**: moves the deal to the lost stage of its pipeline.
- **Move to Stage**: pick the stage from the list.
- **Create**: Zellia allows one open deal for each contact in each pipeline. By default, the node returns the open deal (`alreadyExisted: true`) and does not fail. It can also link a conversation.
- **Get**, **Get Many**, **Update**, **Delete**, **Get History**, **Get Conversations**, **Link Conversation**

### Pipeline

- **Get Many**, **Get** (with stages), **Get Stages**

## Zellia Trigger

Set an optional **Path**, such as `new-lead`, to get a readable URL (`/webhook/new-lead`). Leave it empty to use an automatic ID.

### Source: Account Webhook

When you publish the workflow, n8n registers a webhook in Zellia. When you unpublish it, n8n deletes the webhook. This needs an administrator token.

- **Events**: message created or updated, conversation created, updated or status changed, contact created or updated, and more.
- **Inbox**: optional. The node drops the events of other channels. Zellia sends every event of the account, so the node does this filtering itself. Contact events have no channel, so they always pass.
- **Signature check**: every delivery must have a valid `X-Chatwoot-Signature`. The secret comes from the registration. Requests with a missing or wrong signature, or older than 5 minutes, get a 401 and do not start the workflow. If the node has no stored secret, it rejects every request. Publish the workflow again to register a new webhook.

### Source: Automation Rule

Use this source for deal stage changes. Zellia does not offer deal events as account webhooks.

1. In Zellia, create an automation rule, for example on *Deal stage changed* with the stage condition you need.
2. Add the action **Send webhook event**.
3. Paste the production URL of the node into the action.

Automation rules do not sign their requests, so the node requires a **Secret Token**. Use a long random value, and add `?token=YOUR_TOKEN` to the URL in the rule. Requests without the right token get a 401.

### Filters and output

- **Message Filters**: by default, only incoming messages from the contact start the workflow. Private notes and messages from agent bots and Captain are skipped, so a bot cannot answer itself.
- **Required Labels**: only conversations that have at least one of the labels you list.
- **Simplify** (on by default): the output is a flat object. For messages it has `text`, `conversation_id`, `contact_phone`, `labels`, `sender_type` and other fields. For deal events it has `deal_id`, `value` as a number, `stage_type`, `from_stage_name` and other fields. Turn Simplify off to get the raw Zellia payload.

## Secrets of the triggers

The automation token of the Zellia Trigger and the token of the Captain Tool Trigger can be stored in a **Zellia Webhook Secret API** credential (recommended) or in the node. The credential is encrypted and is kept when you edit the node. The node option stays the default so existing workflows keep working.

## Zellia Captain Tool Trigger

Use it as the endpoint of a Captain custom tool.

1. Set a **Path**, such as `send-image`, and the same HTTP method as in the tool.
2. In Zellia, open **Captain → Tools**, create the tool and paste the production URL of the node.
3. Set the same authentication in the tool and in the node: Bearer token, API key header or Basic.

The output has `tool`, `account_id`, `conversation_id`, `contact_id`, `contact_phone`, `channel_type` and other fields. The tool parameters are in `params`: from the JSON body for POST tools, and from the URL for GET tools. Captain receives the data of the last node as the tool result, so end the workflow with a Set node that holds a short answer for the assistant. Captain waits up to 20 seconds. For longer jobs, choose **Respond → Immediately, With a Fixed Answer**: Captain gets your text at once and the workflow keeps running. The tool itself is created in Zellia (Captain → Tools); the node does not register it. Captain sends parameters only when the tool defines them: in a request template for POST, or as `{{name}}` placeholders in the URL for GET.

## Updating the package in queue mode

When the main instance, the workers and the webhook processors share the same `~/.n8n` volume, n8n does not reload a community package update in the workers and webhook processors (n8n-io/n8n#41897). After you install or update this package:

1. Check that `~/.n8n/nodes/node_modules/n8n-nodes-zellia` contains files.
2. Restart every worker and webhook processor, so they load the new version.

## Notes

- **Conversation ID** is the number in the Zellia URL. It is not an internal database ID.
- Labels are lowercase in Zellia. The node converts the labels you enter to lowercase, and it compares labels without regard to case.
- Operations that return lists send one item for each result. If no deal matches, the node returns no items. To continue with an empty result, turn on **Always Output Data** in the node settings.
- Deal amounts come from Zellia as strings, such as `"850000.0"`. The trigger converts `value` to a number.

## Development

```bash
npm install
npm run build      # compile to dist/
npm run lint       # n8n community node rules
npm test           # build, then run the unit tests (node:test)
npm run dev        # start a local n8n with the nodes linked
```

To publish a new version, update `CHANGELOG.md`, bump the version, then run `npm run release`.

## License

[MIT](LICENSE)
