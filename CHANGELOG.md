# Changelog

## 0.2.2

- Zellia Trigger: new optional **Path** field, so the URL can be readable, such as `/webhook/new-lead`. When it is empty, n8n uses the node's automatic ID, so the URL of an existing trigger without a path changes from `/webhook/<id>/webhook` to `/webhook/<id>`. Update the URL in Zellia after you install this version.
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
