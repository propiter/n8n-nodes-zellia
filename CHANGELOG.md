# Changelog

## 0.2.0

- Message → Send Attachment: new **File Source** option. Choose **URL** to send a file from a public link. The node downloads the file and uploads it to Zellia, so you do not need an HTTP Request node first. It also works when the node is used as an AI Agent tool. **Binary Field** stays the default, so existing nodes do not change.
- URL downloads accept only public addresses. The node refuses localhost, names without a public domain (such as container service names), and private, loopback, link-local and reserved IPs, including IPv6 forms that carry an IPv4 address (IPv4-mapped, NAT64, 6to4, Teredo). It follows at most 3 redirects and checks each hop before it requests it.

## 0.1.0

First release.

- Zellia API credential for agent and agent bot tokens.
- Zellia node: messages (text, private note, buttons, cards, WhatsApp templates, attachments), conversations (start outbound, labels, status, assignment, custom attributes, priority), contacts (create or update by phone, email or identifier), deals (find by conversation, create without duplicates, move, mark as won or lost) and pipelines.
- Zellia Trigger: account webhooks registered automatically and checked by signature, or automation rule webhooks for deal stage changes.
