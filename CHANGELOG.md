# Changelog

## 0.3.0

New:
- Deal → **Register Sale**: Zellia's sale registration in one locked step (agent token).
- Deal → Move to Stage: **Only Move Forward** option and a `result` field (`moved`, `already_in_stage`, `skipped_backward`).
- Deal → Mark as Lost: optional reason saved in a deal attribute.
- Deal → Mark as Won: `amountDiffers` when the deal was already won with another amount.
- Deal: **Wait for the Deal** in the conversation lookup and in Find for Contact, for deals that Zellia opens a moment after a new conversation.
- Message → Send (WhatsApp template): header (text variables or media) and button values (URL suffix or coupon code).
- Credential: optional **Default Country Code** for phone numbers written without a country code.
- **Zellia Webhook Secret API** credential: the trigger tokens can be stored encrypted.
- Captain Tool Trigger: **Respond Immediately, With a Fixed Answer** for long jobs.
- Zellia Trigger: conversation events keep the last message (`text`, `last_message_id`) when Simplify is on.
- Clearer errors for rate limits (429) and unavailable server (5xx).

Changed (check the migration notes):
- Deal → Update **merges** custom attributes with the current ones. Before, it replaced them all, like the Zellia API. To keep the old behaviour, turn on **Replace All Attributes**.
- Deal → Update stops with an error when Zellia ignores attributes or the agent (bot tokens). Before, it reported success.
- Deal → Create returns the open deal that Zellia opened in the meantime instead of failing with "already has an open deal".
- Deal → Move to Stage reads the deal first (one extra request) to report the result, and does not call Zellia when the deal is already in that stage.
- Zellia Trigger (Account Webhook): when the events or the inbox change, the node updates the existing Zellia webhook instead of deleting and creating it. The webhook ID and its secret stay the same.

Migration notes:
- Review every Deal → Update node that sets custom attributes. If the flow relied on deleting the attributes it did not send, turn on **Replace All Attributes**.
- Flows that used a bot token in Deal → Update for custom attributes now fail with a clear error. Use an agent token for that node.
- After the update, restart the n8n workers and webhook processors (see the README).

## 0.2.2

- Zellia Trigger: new optional **Path** field, so the URL can be readable, such as `/webhook/new-lead`. When it is empty, n8n uses the node's automatic ID, so the URL of an existing trigger without a path changes from `/webhook/<id>/webhook` to `/webhook/<id>`. Update the URL in Zellia after you install this version.
- Zellia Trigger (Account Webhook): when the URL of the node changes, for example after you set a path, the node deletes the webhook it registered for the old URL before it registers the new one.
- Zellia Trigger: an accepted call now answers 200 with an empty body. Before, it answered the literal text `firstEntryJson`.

## 0.2.1

- Message → Send Attachment (URL): the node checks the DNS addresses when it connects and connects only to a checked address, on every redirect hop. A name can no longer switch to a private IP after the check (DNS rebinding).
- The whole download has a hard 30-second limit. A server that sends its headers or its body slowly cannot keep the request open longer.

## 0.2.0

- Zellia Captain Tool Trigger: new trigger for Captain custom tools. It reads the conversation, contact and channel from the `X-Chatwoot-*` headers, checks the tool authentication (Bearer, API key header or Basic) and can accept only one account.
- Conversation → Hand Off: in one step, message the contact, leave a private note, add, remove or replace labels, assign an agent or a team, and change the status.
- Conversation → Get Status and Get Custom Attributes, the counterparts of Set Status and Set Custom Attributes.
- Deal → Mark as Won and Mark as Lost: new **Find Deal By → Conversation ID** option. The node finds the open deal of the contact in the pipeline. The `result` field is `won`, `lost`, `already_won`, `already_lost` or `no_deal`.
- Message → Send Attachment: new **File Source** option. Choose **URL** to send a file from a public link. The node downloads the file and uploads it to Zellia, so you do not need an HTTP Request node first. It also works when the node is used as an AI Agent tool. **Binary Field** stays the default, so existing nodes do not change.
- URL downloads accept only public addresses. The node checks the DNS addresses at connect time and connects only to a checked address, so a name cannot switch to a private IP after the check (DNS rebinding). It does this on every redirect hop. The download is streamed, stops at 40 MB and has a 30-second limit for the whole download.
- The package now targets self-hosted n8n only. The DNS check needs the Node `dns` module, which n8n Cloud does not allow.
- URL downloads also refuse names and IPs directly: the node refuses localhost, names without a public domain (such as container service names), and private, loopback, link-local and reserved IPs, including IPv6 forms that carry an IPv4 address (IPv4-mapped, NAT64, 6to4, Teredo). It follows at most 3 redirects and checks each hop before it requests it.

## 0.1.0

First release.

- Zellia API credential for agent and agent bot tokens.
- Zellia node: messages (text, private note, buttons, cards, WhatsApp templates, attachments), conversations (start outbound, labels, status, assignment, custom attributes, priority), contacts (create or update by phone, email or identifier), deals (find by conversation, create without duplicates, move, mark as won or lost) and pipelines.
- Zellia Trigger: account webhooks registered automatically and checked by signature, or automation rule webhooks for deal stage changes.
