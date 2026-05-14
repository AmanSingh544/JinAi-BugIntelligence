import type { ProviderSchema } from '../../../shared/provider-schema';

export const JIRA_SCHEMA: ProviderSchema = {
  id: 'jira',
  name: 'Jira',
  type: 'managed',
  schemaVersion: 1,
  fields: [
    { name: 'domain', type: 'text', label: 'Domain', required: true, hint: 'e.g. myteam.atlassian.net' },
    { name: 'email', type: 'text', label: 'Email', required: true, hint: 'Your Atlassian account email' },
    { name: 'apiToken', type: 'password', label: 'API Token', required: true, hint: 'From id.atlassian.com/manage-profile/security/api-tokens' },
    { name: 'projectKey', type: 'text', label: 'Project Key', required: true, hint: 'e.g. PROJ, BUG' },
  ],
};

export const GITHUB_SCHEMA: ProviderSchema = {
  id: 'github',
  name: 'GitHub Issues',
  type: 'managed',
  schemaVersion: 1,
  fields: [
    { name: 'owner', type: 'text', label: 'Owner', required: true, hint: 'GitHub username or organization' },
    { name: 'repo', type: 'text', label: 'Repository', required: true, hint: 'Repository name' },
    { name: 'token', type: 'password', label: 'Personal Access Token', required: true, hint: 'GitHub PAT with repo scope' },
  ],
};

export const MERIDIAN_SCHEMA: ProviderSchema = {
  id: 'meridian_3sc',
  name: '3SC Meridian',
  type: 'managed',
  schemaVersion: 1,
  fields: [
    { name: 'baseUrl', type: 'text', label: 'Base URL', required: true, hint: 'e.g. https://meridian.example.com' },
    { name: 'apiKey', type: 'password', label: 'API Key', required: true },
    { name: 'projectKey', type: 'text', label: 'Project Key', required: false },
  ],
};

export const GENERIC_HTTP_SCHEMA: ProviderSchema = {
  id: 'generic_http',
  name: 'Custom HTTP / Webhook',
  type: 'generic',
  schemaVersion: 1,
  fields: [
    { name: 'baseUrl', type: 'text', label: 'Base URL', required: true, hint: 'e.g. https://tracker.internal.com' },
    { name: 'auth.type', type: 'select', label: 'Auth Type', required: true, options: ['none', 'bearer', 'basic', 'api_key', 'cookie'] },
    { name: 'auth.token', type: 'password', label: 'Token', hint: 'For Bearer auth' },
    { name: 'auth.username', type: 'text', label: 'Username', hint: 'For Basic auth' },
    { name: 'auth.password', type: 'password', label: 'Password', hint: 'For Basic auth' },
    { name: 'auth.headerName', type: 'text', label: 'Header Name', hint: 'For API Key auth, e.g. X-API-Key' },
    { name: 'auth.apiKey', type: 'password', label: 'API Key', hint: 'For API Key auth' },
    { name: 'endpoints.healthCheck.url', type: 'text', label: 'Health Check URL', hint: 'Optional. Relative or absolute.' },
    { name: 'endpoints.createTicket.url', type: 'text', label: 'Create Ticket URL', required: true },
    { name: 'endpoints.createTicket.method', type: 'select', label: 'Create Ticket Method', required: true, options: ['POST', 'PUT', 'PATCH'] },
    { name: 'templates.headers', type: 'key-value', label: 'Headers', hint: 'Optional custom headers' },
    { name: 'templates.body', type: 'json', label: 'Body Template', required: true, hint: 'JSON with {{var.X}} and {{bug.X}} placeholders' },
    { name: 'responseMapping.ticketIdPath', type: 'text', label: 'Ticket ID Path', required: true, hint: 'e.g. data.id or data.items[0].id' },
    { name: 'responseMapping.ticketUrlPath', type: 'text', label: 'Ticket URL Path', hint: 'e.g. data.url' },
    { name: 'variables', type: 'key-value', label: 'Template Variables', hint: 'Custom values like tenantId, projectId. Available as {{var.key}}' },
  ],
};
