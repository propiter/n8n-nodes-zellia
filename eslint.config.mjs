import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// The URL download resolves DNS to refuse private addresses, which needs the Node dns module.
// n8n Cloud does not allow that module, so this package targets self-hosted n8n only.
export default configWithoutCloudSupport;
