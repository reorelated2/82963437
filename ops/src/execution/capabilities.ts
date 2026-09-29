export interface IntegrationCapability {
  integration: string;
  read: 'NO';
  search: 'NO';
  draft: 'LOCAL ONLY' | 'NO';
  create: 'NO';
  update: 'NO';
  send: 'NO';
  call: 'NO';
  schedule: 'NO';
  confirmDelivery: 'NO';
  confirmCompletion: 'NO';
  mode: 'HUMAN ACTION MODE';
}

/** Section 39. No live capability is claimed. Authentication is not permission to send. */
export function integrationCapabilities(): IntegrationCapability[] {
  const external: IntegrationCapability = {
    integration: '',
    read: 'NO',
    search: 'NO',
    draft: 'NO',
    create: 'NO',
    update: 'NO',
    send: 'NO',
    call: 'NO',
    schedule: 'NO',
    confirmDelivery: 'NO',
    confirmCompletion: 'NO',
    mode: 'HUMAN ACTION MODE',
  };
  return [
    'Gmail',
    'Calendar',
    'Redfin',
    'Agent Tools',
    'MLS',
    'SMS provider',
    'Voice provider',
    'Lender',
    'Transaction management',
    'CRM',
    'Documents',
    'Task management',
    'Data providers',
  ].map((integration) => ({
    ...external,
    integration,
    draft: integration === 'Gmail' || integration === 'SMS provider' ? 'LOCAL ONLY' : 'NO',
  }));
}
